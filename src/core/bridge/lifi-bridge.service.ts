// src/core/bridge/lifi-bridge.service.ts
//
// Thin client for the Simpl API Gateway's LI.FI bridge proxy. The extension
// NEVER talks to LI.FI directly — every cross-chain call routes through the
// gateway, which injects the integrator/referral/API-key server-side. None of
// those secrets, nor any raw provider debug payload, are ever surfaced here:
// quotes are normalized into a small display-safe view before they leave this
// module.
//
// Endpoints used (all under the gateway base URL):
//   GET  /v1/bridge/lifi/chains              — selectable chains
//   GET  /v1/bridge/lifi/tokens?chains=<id>  — token list for a chain
//   POST /v1/bridge/lifi/quote               — a single cross-chain route (JSON body)
//   GET  /v1/bridge/lifi/status?...          — bridge progress for a tx hash
//
// Execution is intentionally limited: only EVM source chains the wallet can
// actually sign (the chains in the local registry) are executable. Every other
// source (Solana / TRON / any EVM chain without a configured RPC) is treated as
// quote-preview only — this module never fabricates signing support.

import { getChainById } from "../networks/chain-registry";
import { normalizeApiErrorBody } from "../api/api-error";
import { parseTradeApiResponse, type SimplTradeQuote } from "../trade/quote-response";
import {
  extractSerializedSolanaTransaction,
  isBridgeDebugEnabled,
  logSolanaInvalidTx,
  type SolanaTxShapeSummary,
} from "../../chains/solana/solana.bridge";
import {
  extractTronTransactionRequest,
  logTronInvalidTx,
} from "../../chains/tron/tron.bridge";

// Resolve the gateway base URL exactly like the market-data client: prefer the
// explicit Simpl API var, fall back to the swap-proxy var, then production.
function resolveApiBaseUrl(): string {
  const candidate =
    (import.meta.env.VITE_SIMPL_API_URL as string | undefined) ??
    (import.meta.env.VITE_SIMPL_SWAP_PROXY_URL as string | undefined) ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();

// ── Monetization — BACKEND-AUTHORITATIVE ────────────────────────────────────
//
// The integrator + fee are injected SERVER-SIDE by the getsimpl-api gateway. The
// extension does NOT send `integrator` or `fee` on a quote and does not treat any
// client value as authoritative; it only DISPLAYS the fee breakdown the gateway
// returns (see parseTradeApiResponse → SimplTradeQuote.fees). The former client
// VITE_LIFI_FEE / VITE_LIFI_INTEGRATOR override was removed.

// Normalize a LI.FI bridge quote (or a getsimpl-api v2 envelope) into the shared
// SimplTradeQuote for the UI fee breakdown. Handles the current legacy shape today
// and the v2 shape once getsimpl-api deploys it.
export function toSimplBridgeQuote(payload: unknown): SimplTradeQuote {
  return parseTradeApiResponse(payload, { kind: "bridge", provider: "lifi" });
}

// LI.FI's sentinel for a chain's native asset (ETH / BNB / MATIC …).
export const LIFI_NATIVE_ADDRESS =
  "0x0000000000000000000000000000000000000000";

// ── Diagnostics ─────────────────────────────────────────────────────────────
//
// Opt-in, structured bridge diagnostics. On in dev builds, when
// VITE_BRIDGE_DEBUG="true", OR at runtime in a built/unpacked extension via:
//   localStorage.setItem("simpl.debug.bridge", "1");  location.reload();
// Silent for production users otherwise. The single gate lives in solana.bridge
// (isBridgeDebugEnabled) so quote- and execution-side logs flip together. These
// logs are privacy-safe by construction: addresses are reduced to a
// {evm|solana|…} TYPE tag (classifyAddressType) before logging — never the raw
// address — and we never log secrets, API keys, headers or raw provider payloads.

export function bridgeDebugLog(
  event: string,
  data: Record<string, unknown>,
): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[SIMPL bridge] ${event}`, data);
}

// Raw-response shape diagnostics, prefixed [bridge:lifi]. Logs ONLY safe
// metadata about the gateway/LI.FI quote BEFORE normalization — key names, value
// TYPES and string LENGTHS — never values, never the serialized tx.
function lifiShapeLog(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[bridge:lifi] ${event}`, data);
}

// Safe, value-free key/type summary of an unknown value.
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function keyNames(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as object)
    : [];
}

// String length of a field if it is a string, else null (never the value).
function strLen(value: unknown): number | null {
  return typeof value === "string" ? value.length : null;
}

// Build a privacy-safe shape summary of the RAW quote response: top-level keys,
// transactionRequest keys + candidate-field string lengths, includedSteps shape,
// and tool/provider names. Used by the [bridge:lifi] logger and the dev helper.
function summarizeRawQuoteShape(raw: unknown): Record<string, unknown> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const txReq = (r.transactionRequest ?? null) as Record<string, unknown> | null;
  const steps = Array.isArray(r.includedSteps)
    ? r.includedSteps
    : Array.isArray(r.steps)
      ? r.steps
      : [];
  const firstStep = (steps[0] ?? null) as Record<string, unknown> | null;
  const action = (r.action ?? null) as Record<string, unknown> | null;
  const estimate = (r.estimate ?? null) as Record<string, unknown> | null;
  const actionToToken = (action?.toToken ?? null) as Record<string, unknown> | null;
  const rootToToken = (r.toToken ?? null) as Record<string, unknown> | null;
  const toChainIdRaw =
    action && typeof action.toChainId === "number" ? action.toChainId : 0;
  return {
    topLevelKeys: keyNames(r),
    tool: typeof r.tool === "string" ? r.tool : null,
    toolDetailsName:
      r.toolDetails && typeof r.toolDetails === "object"
        ? ((r.toolDetails as { name?: unknown }).name ?? null)
        : null,
    transactionRequestType: shapeOf(r.transactionRequest),
    transactionRequestKeys: keyNames(r.transactionRequest),
    // The format hint is safe metadata (e.g. "base64" | "base58"), not a secret.
    transactionRequestFormat:
      txReq && typeof txReq.format === "string" ? txReq.format : null,
    transactionRequestFieldTypes: txReq
      ? {
          to: shapeOf(txReq.to),
          from: shapeOf(txReq.from),
          chainId: shapeOf(txReq.chainId),
          data: shapeOf(txReq.data),
          serializedTransaction: shapeOf(txReq.serializedTransaction),
          transaction: shapeOf(txReq.transaction),
          tx: shapeOf(txReq.tx),
          rawTransaction: shapeOf(txReq.rawTransaction),
          swapTransaction: shapeOf(txReq.swapTransaction),
          instructions: shapeOf(txReq.instructions),
          // TRON (TVM): raw_data_hex / raw_data are where TRON tx bodies appear.
          raw_data_hex: shapeOf(txReq.raw_data_hex),
          raw_data: shapeOf(txReq.raw_data),
        }
      : null,
    transactionRequestStringLengths: txReq
      ? {
          data: strLen(txReq.data),
          serializedTransaction: strLen(txReq.serializedTransaction),
          transaction: strLen(txReq.transaction),
          tx: strLen(txReq.tx),
          rawTransaction: strLen(txReq.rawTransaction),
          swapTransaction: strLen(txReq.swapTransaction),
          raw_data_hex: strLen(txReq.raw_data_hex),
        }
      : null,
    // First hex chars of the EVM-looking `data` field — for TRON routes this is
    // the protobuf tag (0a…) that confirms it's a TRON raw_data, not EVM calldata.
    transactionRequestDataFirstBytes:
      typeof txReq?.data === "string"
        ? txReq.data.replace(/^0x/u, "").slice(0, 4)
        : null,
    sourceChainType: bridgeChainType(
      action && typeof action.fromChainId === "number" ? action.fromChainId : 0,
    ),
    actionType: shapeOf(r.action),
    estimateKeys: keyNames(r.estimate),
    // ── Destination amount / token diagnostics (safe; values are not secrets) ──
    estimateToAmountType: shapeOf(estimate?.toAmount),
    estimateToAmount: typeof estimate?.toAmount === "string" || typeof estimate?.toAmount === "number" ? estimate?.toAmount : null,
    estimateToAmountMin: typeof estimate?.toAmountMin === "string" || typeof estimate?.toAmountMin === "number" ? estimate?.toAmountMin : null,
    rootToAmountType: shapeOf(r.toAmount),
    rootToAmount: typeof r.toAmount === "string" || typeof r.toAmount === "number" ? r.toAmount : null,
    rootToAmountMin: typeof r.toAmountMin === "string" || typeof r.toAmountMin === "number" ? r.toAmountMin : null,
    actionToTokenSymbol: typeof actionToToken?.symbol === "string" ? actionToToken.symbol : null,
    actionToTokenDecimals: typeof actionToToken?.decimals === "number" ? actionToToken.decimals : null,
    actionToTokenAddress: typeof actionToToken?.address === "string" ? actionToToken.address : null,
    rootToTokenSymbol: typeof rootToToken?.symbol === "string" ? rootToToken.symbol : null,
    rootToTokenDecimals: typeof rootToToken?.decimals === "number" ? rootToToken.decimals : null,
    destinationChainType: bridgeChainType(toChainIdRaw),
    executionType: shapeOf(r.execution),
    toolDataType: shapeOf(r.toolData),
    providerDataType: shapeOf(r.providerData),
    includedStepsType: shapeOf(r.includedSteps ?? r.steps),
    includedStepsCount: steps.length,
    firstStepKeys: keyNames(firstStep),
    firstStepTransactionRequestType: firstStep
      ? shapeOf(firstStep.transactionRequest)
      : "none",
    firstStepTransactionRequestKeys: firstStep
      ? keyNames(firstStep.transactionRequest)
      : [],
  };
}

// Most-recent raw quote shape summary (safe metadata only), for the dev helper.
let lastRawQuoteShape: Record<string, unknown> | null = null;

// Dev helper: print (and best-effort clipboard-copy) the latest raw quote SHAPE
// summary — safe metadata only, never the serialized tx / keys / signatures.
// In dev it is also attached to globalThis so it can be called from the console.
export function copyBridgeQuoteShapeForDebug(): Record<string, unknown> | null {
  // eslint-disable-next-line no-console
  console.info("[bridge:lifi] quote-shape (latest)", lastRawQuoteShape);
  try {
    const text = JSON.stringify(lastRawQuoteShape ?? {}, null, 2);
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => unknown } } })
      .navigator?.clipboard?.writeText?.(text);
  } catch {
    // Clipboard is best-effort and never required.
  }
  return lastRawQuoteShape;
}

// Attach the dev helper to globalThis when diagnostics are enabled — including
// the runtime localStorage flag — so it is callable from the Console in a built/
// unpacked extension, not only under import.meta.env.DEV. Quiet by default: when
// the flag is OFF nothing is attached and nothing is logged.
//
// To enable in a built/unpacked extension, run in the popup Console:
//   localStorage.setItem("simpl.debug.bridge", "1")
//   location.reload()
//   copyBridgeQuoteShapeForDebug()
if (isBridgeDebugEnabled()) {
  (globalThis as Record<string, unknown>).copyBridgeQuoteShapeForDebug =
    copyBridgeQuoteShapeForDebug;
  // eslint-disable-next-line no-console
  console.info(
    "[bridge:lifi] diagnostics ON — get a quote, then run copyBridgeQuoteShapeForDebug() in this Console.",
  );
}

// Classify an address by type WITHOUT exposing the address itself — so callers
// can log "fromAddress type" safely. TRON is checked BEFORE Solana: a TRON base58
// address (T… + 33 base58 chars) is also valid base58 of Solana's length, so the
// order matters.
export function classifyAddressType(
  address: string | null | undefined,
): "evm" | "solana" | "tron" | "none" | "unknown" {
  if (!address) return "none";
  if (/^0x[0-9a-fA-F]{40}$/u.test(address)) return "evm";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(address)) return "tron";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(address)) return "solana";
  return "unknown";
}

// A short, MASKED address for diagnostics — keeps only the first/last 4 chars so
// the chain + format are visible without logging the full address. Prefixed by
// type: "Txxxx…xxxx" (TRON), "0xab…cdef" (EVM), "Solana xxxx…xxxx" (SVM).
export function maskAddressForDebug(address: string | null | undefined): string {
  if (!address) return "none";
  const type = classifyAddressType(address);
  const short =
    address.length > 10
      ? `${address.slice(0, 4)}…${address.slice(-4)}`
      : address;
  if (type === "solana") return `Solana ${short}`;
  return short;
}

// Whether an address is well-formed for the given chain's VM family. Used purely
// for diagnostics (fromAddressValid / toAddressValid) — the gateway is the
// authority on acceptance.
export function isValidAddressForChain(
  address: string | null | undefined,
  chainId: number,
): boolean {
  if (!address) return false;
  const family = bridgeChainType(chainId);
  if (family === "EVM") return /^0x[0-9a-fA-F]{40}$/u.test(address);
  if (family === "TVM") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(address);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(address); // SVM
}

// Whether a TRON route's `from` is a TRON address in ANY representation. LI.FI
// returns TRON addresses in base58 (T…) OR hex (41…) form depending on the
// provider; both are valid owners. Only a clearly non-TRON value (e.g. an EVM
// 0x…40 address) should disqualify a TRON-source route. A null/omitted `from`
// is allowed — the wallet enforces the real signer-match at execution time.
function isTronSourceAddressForm(value: string | null): boolean {
  if (value == null) return true;
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(value)) return true;
  // TRON hex address: 0x41 version byte + 20-byte body → "41" + 40 hex (the
  // leading 0x is optional). NOT an EVM 0x…40, which has no 41 version prefix.
  return /^(?:0x)?41[0-9a-fA-F]{40}$/iu.test(value);
}

// Classify a TRON route's `from` for the [bridge:lifi] tron-executable-gate log —
// safe metadata only (a TYPE tag, never the address itself).
function tronFromAddressFormLabel(
  value: string | null,
): "base58" | "hex" | "none" | "non-tron" {
  if (value == null) return "none";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(value)) return "base58";
  if (/^(?:0x)?41[0-9a-fA-F]{40}$/iu.test(value)) return "hex";
  return "non-tron";
}

// VM family for the supported production chain set. Solana (SVM) and TRON (TVM)
// are the non-EVM source/destinations the bridge offers; everything else is EVM.
// UTXO / other VMs are not offered, so they fall through to "EVM" and are gated
// out of execution by isSignableSourceChain instead.
export function bridgeChainType(chainId: number): "EVM" | "SVM" | "TVM" {
  if (chainId === LIFI_SOLANA_CHAIN_ID) return "SVM";
  if (chainId === LIFI_TRON_CHAIN_ID) return "TVM";
  return "EVM";
}

const DEFAULT_TIMEOUT_MS = 20_000;

// HTTP error from the gateway that PRESERVES the response body (a non-2xx is
// thrown, not swallowed) so callers can surface the actual safe reason instead of
// a bare "400 Bad Request". `message` stays "<status> <statusText>" so existing
// 404/"not found" detection keeps working.
export class BridgeHttpError extends Error {
  readonly status: number;
  readonly bodyText: string | null;
  readonly bodyJson: Record<string, unknown> | null;
  constructor(
    status: number,
    statusText: string,
    bodyText: string | null,
    bodyJson: Record<string, unknown> | null,
  ) {
    super(`${status} ${statusText}`);
    this.name = "BridgeHttpError";
    this.status = status;
    this.bodyText = bodyText;
    this.bodyJson = bodyJson;
  }
}

async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { accept: "application/json", ...(rest.headers ?? {}) },
    });
    if (!response.ok) {
      // Read the body ONCE (text), then best-effort JSON-parse it, so callers can
      // classify the failure from the gateway/provider's own message.
      let bodyText: string | null = null;
      let bodyJson: Record<string, unknown> | null = null;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          if (parsed && typeof parsed === "object") {
            bodyJson = parsed as Record<string, unknown>;
          }
        } catch {
          bodyJson = null;
        }
      }
      throw new BridgeHttpError(
        response.status,
        response.statusText,
        bodyText,
        bodyJson,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Chains ────────────────────────────────────────────────────────────────

export type BridgeChain = {
  id: number;
  key: string;
  name: string;
  // "EVM" | "SVM" | "UTXO" | … — used to pick the right address format and to
  // decide whether a source chain can be signed locally.
  chainType: string;
  logoUrl: string | null;
  nativeSymbol: string;
  blockExplorerUrl: string | null;
  // True when the wallet can actually build + sign a transaction for this chain
  // as a SOURCE (an EVM chain present in the local registry with an RPC URL).
  signable: boolean;
};

function isEvmChainType(chainType: unknown): boolean {
  return typeof chainType === "string" && chainType.toUpperCase() === "EVM";
}

// A source chain is signable only when it's an EVM chain we have a configured
// RPC + explorer for (the local registry). Everything else is preview-only.
export function isSignableSourceChain(chainId: number): boolean {
  return getChainById(chainId)?.family === "evm";
}

type RawLifiChain = {
  id?: number;
  key?: string;
  name?: string;
  chainType?: string;
  logoURI?: string | null;
  nativeToken?: { symbol?: string } | null;
  coin?: string;
  metamask?: { blockExplorerUrls?: string[] } | null;
};

function normalizeChain(raw: RawLifiChain): BridgeChain | null {
  if (typeof raw.id !== "number") return null;
  const explorer = raw.metamask?.blockExplorerUrls?.[0] ?? null;
  return {
    id: raw.id,
    key: raw.key ?? String(raw.id),
    name: raw.name ?? `Chain ${raw.id}`,
    chainType: raw.chainType ?? "EVM",
    logoUrl: raw.logoURI ?? null,
    nativeSymbol: raw.nativeToken?.symbol ?? raw.coin ?? "",
    blockExplorerUrl: explorer ? explorer.replace(/\/+$/u, "") : null,
    signable:
      isEvmChainType(raw.chainType) && isSignableSourceChain(raw.id),
  };
}

export async function getBridgeChains(): Promise<BridgeChain[]> {
  const data = await fetchJson<{ chains?: RawLifiChain[] }>(
    `${API_BASE_URL}/v1/bridge/lifi/chains`,
  );
  const list = Array.isArray(data?.chains) ? data.chains : [];
  return list
    .map(normalizeChain)
    .filter((chain): chain is BridgeChain => chain !== null);
}

// ── Tokens ────────────────────────────────────────────────────────────────

export type BridgeToken = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  priceUsd: number | null;
  // True for the chain's native asset (LI.FI zero address).
  isNative: boolean;
};

type RawLifiToken = {
  address?: string;
  chainId?: number;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoURI?: string | null;
  priceUSD?: string | number | null;
};

function normalizeToken(raw: RawLifiToken, chainId: number): BridgeToken | null {
  if (typeof raw.address !== "string" || typeof raw.symbol !== "string") {
    return null;
  }
  const priceRaw = raw.priceUSD;
  const price =
    priceRaw == null || priceRaw === ""
      ? null
      : Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : null;
  return {
    chainId,
    address: raw.address,
    symbol: raw.symbol,
    name: raw.name ?? raw.symbol,
    decimals: typeof raw.decimals === "number" ? raw.decimals : 18,
    logoUrl: raw.logoURI ?? null,
    priceUsd: price,
    isNative:
      raw.address.toLowerCase() === LIFI_NATIVE_ADDRESS.toLowerCase(),
  };
}

export async function getBridgeTokens(chainId: number): Promise<BridgeToken[]> {
  const search = new URLSearchParams({ chains: String(chainId) });
  const data = await fetchJson<{ tokens?: Record<string, RawLifiToken[]> }>(
    `${API_BASE_URL}/v1/bridge/lifi/tokens?${search.toString()}`,
  );
  const byChain = data?.tokens ?? {};
  const list = byChain[String(chainId)] ?? [];
  return list
    .map((raw) => normalizeToken(raw, chainId))
    .filter((token): token is BridgeToken => token !== null);
}

// Fetch tokens for SEVERAL chains in one round-trip (LI.FI accepts a comma list)
// and return them flattened, each tagged with its own chainId — the basis for
// cross-network token search in the picker. Production chains only (callers pass
// mainnet ids; no devnet/testnet ids are ever included).
export async function getBridgeTokensForChains(
  chainIds: number[],
): Promise<BridgeToken[]> {
  const unique = Array.from(new Set(chainIds.filter((id) => Number.isFinite(id))));
  if (unique.length === 0) return [];
  const search = new URLSearchParams({ chains: unique.join(",") });
  const data = await fetchJson<{ tokens?: Record<string, RawLifiToken[]> }>(
    `${API_BASE_URL}/v1/bridge/lifi/tokens?${search.toString()}`,
  );
  const byChain = data?.tokens ?? {};
  const out: BridgeToken[] = [];
  for (const id of unique) {
    const list = byChain[String(id)] ?? [];
    for (const raw of list) {
      const token = normalizeToken(raw, id);
      if (token) out.push(token);
    }
  }
  return out;
}

// ── Quote ─────────────────────────────────────────────────────────────────

export type BridgeQuoteParams = {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmountBaseUnits: string;
  fromAddress: string;
  toAddress?: string;
  slippageBps?: number;
  // Route preference (e.g. "CHEAPEST" | "FASTEST"). Passed straight through to
  // the gateway when present; the gateway picks its own default otherwise.
  order?: string;
  // Optional bridge/exchange allow/deny lists, forwarded only when set.
  allowBridges?: string[];
  denyBridges?: string[];
  allowExchanges?: string[];
  denyExchanges?: string[];
  // Display-only token metadata, used ONLY for the safe request diagnostics
  // ([bridge:lifi] quote-request-safe). Never sent to the gateway.
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  fromTokenDecimals?: number;
};

// An EVM transaction the wallet can sign + send for an executable route. Only
// the fields the send pipeline needs are kept — never the raw provider object.
export type BridgeTransactionRequest = {
  to: string;
  data: string;
  value: string;
  chainId: number;
  // Optional gas hints LI.FI may include on the route — surfaced for diagnostics
  // and an affordability preflight (estimateGas remains authoritative for the
  // actual send). Decimal or hex strings, as the provider returned them.
  gasLimit: string | null;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
};

// A display-safe, normalized quote. Deliberately omits API keys, referral
// accounts, integrator strings and any raw debug field from the provider.
export type BridgeQuote = {
  fromChainId: number;
  toChainId: number;
  fromTokenSymbol: string;
  fromTokenDecimals: number;
  toTokenSymbol: string;
  toTokenDecimals: number;
  fromAmountBaseUnits: string;
  toAmountBaseUnits: string;
  toAmountMinBaseUnits: string | null;
  // Human display name of the bridge/tool, e.g. "Across", "Stargate".
  toolName: string;
  toolKey: string | null;
  // Estimated gas cost on the source chain, in native base units (wei).
  gasCostBaseUnits: string | null;
  gasCostSymbol: string | null;
  gasCostDecimals: number;
  // Bridge/provider fee, summarised as { amount, symbol } in token base units.
  feeCostBaseUnits: string | null;
  feeCostSymbol: string | null;
  feeCostDecimals: number;
  slippage: number | null;
  estimatedDurationSeconds: number | null;
  // ERC-20 spender that must be approved before an executable bridge, if any.
  approvalAddress: string | null;
  // Present only for executable EVM source routes.
  transactionRequest: BridgeTransactionRequest | null;
  // Transaction format the route's source step needs: "evm" (EVM tx request),
  // "solana" (serialized SVM transaction), "tron" (TVM raw_data_hex), or "other"
  // (unsupported VM).
  txFormat: "evm" | "solana" | "tron" | "other";
  // Canonical, standard-base64 serialized Solana transaction — present ONLY when
  // txFormat is "solana" AND a provider payload was extracted and successfully
  // deserialized (the single source of truth for Solana executability). Never a
  // raw provider payload.
  solanaTransactionData: string | null;
  // Provider field the Solana tx was extracted from (diagnostics / invariant).
  solanaTransactionSourceField: string | null;
  // Whether the extracted Solana tx is a versioned (v0) or legacy transaction.
  solanaTransactionFormat: "versioned" | "legacy" | null;
  // Decoded byte length of the canonical serialized Solana tx.
  solanaTransactionByteLength: number | null;
  // TRON (TVM) source payload — present ONLY when txFormat is "tron" AND a TRON
  // raw_data_hex was extracted from the provider quote (the single source of truth
  // for TRON executability). The hex has NO 0x prefix. Never a raw provider blob.
  tronTransactionData: string | null;
  // Provider field the TRON tx was extracted from (diagnostics / invariant).
  tronTransactionSourceField: string | null;
  // How the provider represented the TRON tx (rawDataHex | tronTxObject | serialized).
  tronTransactionShape: string | null;
  // The base58 owner (`from`) the route was built for, when the provider exposed
  // it — used as a final signer-match guard before broadcast.
  tronFromAddress: string | null;
  // feeLimit (sun) the provider set, when available (informational).
  tronFeeLimit: string | null;
  // True when a TRON-SOURCE route's token requires a TRC-20 approval first (the
  // provider returned an approvalAddress). The UI checks the live allowance.
  tronNeedsApproval: boolean;
  // True when the wallet can sign + send this route locally right now.
  executable: boolean;
  // Coarse execution readiness for the UI / diagnostics:
  //   "executable" — a tx the wallet can sign + send is present,
  //   "quoteOnly"  — a valid quote but no signable tx (preview only),
  //   "unsupported"— the route's tx format isn't something we can sign.
  executionStatus: "executable" | "quoteOnly" | "unsupported";
  // Short, human-readable, display-safe reason behind executionStatus.
  executionReason: string;
  // Source / destination chain family, for branching and diagnostics.
  sourceChainType: "EVM" | "SVM" | "TVM";
  destinationChainType: "EVM" | "SVM" | "TVM";
};

// LI.FI's Solana (SVM) chain id. Used to detect Solana-source routes.
export const LIFI_SOLANA_CHAIN_ID = 1151111081099710;

// LI.FI's TRON (TVM) chain id. Identical to the wallet's canonical TRON routing
// key (TRON_MAINNET_CHAIN_ID, 0x2b6653dc) — LI.FI returns Tron under this id with
// chainType "TVM". Used to detect TRON-source / TRON-destination routes.
export const LIFI_TRON_CHAIN_ID = 728126428;

// LI.FI's sentinel address for NATIVE TRX. Unlike EVM/SVM natives (the 0x000…0
// zero address), LI.FI identifies native TRX by this specific base58 address —
// using the EVM zero address for TRON native would be rejected. Used to seed the
// token picker's TRX entry so it matches LI.FI's canonical identifier.
export const LIFI_TRON_NATIVE_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

type RawGasCost = {
  amount?: string;
  token?: { symbol?: string; decimals?: number } | null;
};

type RawFeeCost = {
  name?: string;
  amount?: string;
  token?: { symbol?: string; decimals?: number } | null;
  included?: boolean;
};

type RawTxRequest = {
  to?: string;
  data?: string;
  value?: string;
  chainId?: number;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  // Gateway-normalized format hint: "evm" | "solana" | "non-evm". When absent we
  // infer EVM from the presence of an EVM `to` + `data`.
  format?: string;
  // Solana payload: the gateway returns the serialized SVM transaction here and
  // may also mirror it into `data`. Prefer this field for Solana execution.
  serializedTransaction?: string | null;
  // TRON payload: LI.FI returns the TRON tx body as hex-encoded raw_data in
  // `data` (an EVM-looking wrapper with a base58 `to`); some providers expose it
  // as raw_data_hex / a nested transaction object. Probed by the TRON extractor.
  raw_data_hex?: string | null;
  from?: string;
};

type RawBridgeQuote = {
  // Simpl proxy may stamp this to flag a non-executable preview.
  executionStatus?: string;
  executable?: boolean;
  tool?: string;
  toolDetails?: { key?: string; name?: string } | null;
  action?: {
    fromToken?: { symbol?: string; decimals?: number; address?: string } | null;
    toToken?: { symbol?: string; decimals?: number; address?: string } | null;
    fromChainId?: number;
    toChainId?: number;
    slippage?: number;
  } | null;
  estimate?: {
    fromAmount?: string | number;
    toAmount?: string | number;
    toAmountMin?: string | number;
    approvalAddress?: string;
    executionDuration?: number;
    gasCosts?: RawGasCost[];
    feeCosts?: RawFeeCost[];
  } | null;
  transactionRequest?: RawTxRequest | null;
  // Some providers surface the ERC-20 approval spender at the root rather than
  // (or in addition to) estimate.approvalAddress.
  approvalAddress?: string;
  // Some gateway/provider variants mirror the destination amount + token at the
  // ROOT instead of (or in addition to) `estimate`/`action`. Used as fallbacks.
  toAmount?: string | number;
  toAmountMin?: string | number;
  toToken?: { symbol?: string; decimals?: number; address?: string } | null;
  // Possible nesting sites for the executable payload on Mayan / LI.FI advanced
  // routes. Typed loosely — extraction probes them defensively at runtime.
  includedSteps?: unknown[];
  steps?: unknown[];
  toolData?: unknown;
  providerData?: unknown;
  execution?: unknown;
};

// Convert a possibly-hex (0x…) / decimal string OR a number to a decimal
// base-unit string. Returns null when it's missing or unparseable (callers must
// distinguish "unavailable" from a real "0"). Accepts numbers because some
// gateway variants return amounts as JSON numbers, not strings — treating those
// as null was the cause of a "0 SOL" display on EVM → Solana routes.
function toBaseUnitString(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)).toString() : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return BigInt(value.trim()).toString();
  } catch {
    return null;
  }
}

// Gas costs are all denominated in the source chain's native token, so summing
// their base units is valid. Symbol/decimals come from the first entry.
function sumGasCosts(costs: RawGasCost[] | undefined): {
  amount: string | null;
  symbol: string | null;
  decimals: number;
} {
  if (!Array.isArray(costs) || costs.length === 0) {
    return { amount: null, symbol: null, decimals: 18 };
  }
  let total = 0n;
  let symbol: string | null = null;
  let decimals = 18;
  for (const cost of costs) {
    const raw = toBaseUnitString(cost.amount);
    if (raw == null) continue;
    try {
      total += BigInt(raw);
      if (symbol == null) {
        symbol = cost.token?.symbol ?? null;
        decimals = cost.token?.decimals ?? 18;
      }
    } catch {
      // skip unparseable entry
    }
  }
  return { amount: total > 0n ? total.toString() : null, symbol, decimals };
}

// Surface a single representative bridge fee. Fees can be in different tokens,
// so we never sum them — we take the first parseable cost and keep its token
// metadata so the UI can format it correctly.
function pickFeeCost(costs: RawFeeCost[] | undefined): {
  amount: string | null;
  symbol: string | null;
  decimals: number;
} {
  if (!Array.isArray(costs) || costs.length === 0) {
    return { amount: null, symbol: null, decimals: 18 };
  }
  for (const cost of costs) {
    const raw = toBaseUnitString(cost.amount);
    if (raw == null) continue;
    try {
      if (BigInt(raw) > 0n) {
        return {
          amount: raw,
          symbol: cost.token?.symbol ?? null,
          decimals: cost.token?.decimals ?? 18,
        };
      }
    } catch {
      // skip
    }
  }
  return { amount: null, symbol: null, decimals: 18 };
}

function normalizeTxRequest(
  raw: RawTxRequest | null | undefined,
  fallbackChainId: number,
): BridgeTransactionRequest | null {
  if (!raw || typeof raw.to !== "string" || typeof raw.data !== "string") {
    return null;
  }
  const gasStr = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v : null;
  return {
    to: raw.to,
    data: raw.data,
    value: raw.value ?? "0",
    chainId: typeof raw.chainId === "number" ? raw.chainId : fallbackChainId,
    gasLimit: gasStr(raw.gasLimit),
    gasPrice: gasStr(raw.gasPrice),
    maxFeePerGas: gasStr(raw.maxFeePerGas),
    maxPriorityFeePerGas: gasStr(raw.maxPriorityFeePerGas),
  };
}

// Classify the source-step transaction format the route needs. Prefers the
// gateway's explicit `format` hint, then falls back to inferring from the tx
// shape and the SOURCE chain family. TRON / unknown VMs are "other" → never
// executable here.
//
// The shape fallback matters: LI.FI's Solana transactionRequest carries a
// base64 `data` blob but NO EVM `to` field, and the gateway does not always
// stamp `format`. Without the source-chain check below, every such Solana route
// would misclassify as "other" and silently degrade to preview-only.
function detectTxFormat(
  raw: RawTxRequest | null | undefined,
  fromChainId: number,
): "evm" | "solana" | "tron" | "other" {
  const fmt =
    raw && typeof raw.format === "string" ? raw.format.toLowerCase() : "";
  const txChainId = raw && typeof raw.chainId === "number" ? raw.chainId : null;
  if (fmt === "solana" || fmt === "svm") return "solana";
  if (fmt === "tron" || fmt === "tvm") return "tron";
  // CRITICAL: a TRON route's transactionRequest LOOKS EVM (it has `to` + `data`)
  // and may even carry a chainId, so the TVM check must come BEFORE the EVM shape
  // inference. The source chain OR the tx's own chainId being TRON is decisive.
  if (txChainId === LIFI_TRON_CHAIN_ID || fromChainId === LIFI_TRON_CHAIN_ID) {
    return "tron";
  }
  if (fmt === "evm") return "evm";
  if (fmt) return "other"; // explicit other non-evm VM
  // No explicit hint — the SOURCE chain is the authority for the VM family, so a
  // Solana-source route is always "solana" (extraction decides if it's
  // executable). Only then fall back to inferring EVM from the tx shape.
  if (fromChainId === LIFI_SOLANA_CHAIN_ID) return "solana";
  if (raw && typeof raw.to === "string" && typeof raw.data === "string") {
    return "evm";
  }
  return "other";
}

// Result of searching the whole raw quote for an executable Solana tx.
type SolanaQuoteExtraction =
  | {
      ok: true;
      serializedBase64: string;
      sourceField: string;
      format: "versioned" | "legacy";
      byteLength: number;
    }
  | {
      ok: false;
      // True when the provider returned an instruction bundle / unsigned-tx
      // object / a step that needs a separate build call — not a serialized tx.
      requiresBuild: boolean;
      shapeSummary: SolanaTxShapeSummary;
    };

// A value looks like an instruction bundle / unsigned tx OBJECT (needs building)
// rather than a serialized transaction string.
function looksLikeBuildPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.instructions) ||
    (typeof v.message === "object" && v.message !== null) ||
    Array.isArray(v.accountKeys) ||
    (typeof v.recentBlockhash === "string" && Array.isArray(v.keys))
  );
}

// Search the ENTIRE raw quote — not just transactionRequest — for an executable
// Solana transaction, since Mayan / LI.FI advanced routes nest it in different
// places. Each candidate root is handed to the SAME generic extractor the
// executor uses, so gating and execution can never disagree on the payload.
function extractSolanaTxFromQuote(raw: RawBridgeQuote): SolanaQuoteExtraction {
  const r = raw as unknown as Record<string, unknown>;
  const roots: Array<{ label: string; value: unknown }> = [
    { label: "transactionRequest", value: r.transactionRequest },
    { label: "root", value: r },
    { label: "estimate", value: r.estimate },
    { label: "action", value: r.action },
    { label: "execution", value: r.execution },
    { label: "toolData", value: r.toolData },
    { label: "providerData", value: r.providerData },
  ];
  const steps = Array.isArray(r.includedSteps)
    ? r.includedSteps
    : Array.isArray(r.steps)
      ? r.steps
      : [];
  steps.forEach((step, i) => {
    const so = (step ?? {}) as Record<string, unknown>;
    roots.push({
      label: `includedSteps[${i}].transactionRequest`,
      value: so.transactionRequest,
    });
    roots.push({
      label: `includedSteps[${i}].toolDetails`,
      value: so.toolDetails,
    });
    roots.push({ label: `includedSteps[${i}]`, value: so });
  });

  let requiresBuild = false;
  let firstFailSummary: SolanaTxShapeSummary | null = null;

  for (const root of roots) {
    if (root.value == null) continue;
    if (looksLikeBuildPayload(root.value)) requiresBuild = true;
    const extraction = extractSerializedSolanaTransaction(root.value);
    if (extraction.ok) {
      return {
        ok: true,
        serializedBase64: extraction.serializedBase64,
        // Qualify the field with the root it was found under for diagnostics.
        sourceField:
          extraction.sourceField === "transactionRequest"
            ? root.label
            : `${root.label}.${extraction.sourceField}`,
        format: extraction.format,
        byteLength: extraction.byteLength,
      };
    }
    if (!firstFailSummary && root.label === "transactionRequest") {
      firstFailSummary = extraction.shapeSummary;
    }
  }

  const shapeSummary: SolanaTxShapeSummary =
    firstFailSummary ?? {
      payloadType: shapeOf(r.transactionRequest),
      keys: keyNames(r.transactionRequest),
      candidateField: null,
      stringLength: null,
      decodedByteLength: null,
      firstByte: null,
      deserError: "no decodable serialized-tx field in any known location",
    };
  return { ok: false, requiresBuild, shapeSummary };
}

// Resolve the ERC-20 approval spender for an EVM-source route, robustly across
// provider shapes: estimate.approvalAddress, a root-level approvalAddress, then
// any includedStep's estimate.approvalAddress. LI.FI's allowance target is NOT
// the 0x swap allowanceTarget — it is this bridge spender. Returns null when none
// is present (a native-asset source, or a route that needs no approval).
function resolveApprovalAddress(raw: RawBridgeQuote): string | null {
  const fromEstimate = raw.estimate?.approvalAddress;
  if (typeof fromEstimate === "string" && fromEstimate) return fromEstimate;
  if (typeof raw.approvalAddress === "string" && raw.approvalAddress) {
    return raw.approvalAddress;
  }
  const steps = Array.isArray(raw.includedSteps)
    ? raw.includedSteps
    : Array.isArray(raw.steps)
      ? raw.steps
      : [];
  for (const step of steps) {
    const so = (step ?? {}) as { estimate?: { approvalAddress?: unknown } };
    const addr = so.estimate?.approvalAddress;
    if (typeof addr === "string" && addr) return addr;
  }
  return null;
}

function normalizeQuote(raw: RawBridgeQuote): BridgeQuote {
  const action = raw.action ?? {};
  const estimate = raw.estimate ?? {};
  const fromChainId = action.fromChainId ?? 0;
  const toChainId = action.toChainId ?? 0;
  const destinationChainType = bridgeChainType(toChainId);

  // Destination token + amount, resolved robustly across gateway variants:
  // prefer action.toToken, fall back to a root-level toToken; prefer
  // estimate.toAmount(/Min), fall back to root toAmount(/Min). CRITICAL: for a
  // Solana destination, native SOL is 9 decimals — never the EVM 18 default,
  // which truncated the received SOL amount to "0".
  // …and for a TRON destination, native TRX is 6 decimals — never the EVM 18
  // default. When the provider omits token info we fall back per-VM, never to 18
  // for a non-EVM destination (which would mis-scale the received amount).
  const toTokenInfo = action.toToken ?? raw.toToken ?? null;
  const toTokenDecimals =
    typeof toTokenInfo?.decimals === "number"
      ? toTokenInfo.decimals
      : destinationChainType === "SVM"
        ? 9
        : destinationChainType === "TVM"
          ? 6
          : 18;
  const toTokenSymbol =
    toTokenInfo?.symbol ??
    (destinationChainType === "SVM"
      ? "SOL"
      : destinationChainType === "TVM"
        ? "TRX"
        : "");
  // null when the provider didn't return an amount → surfaced as "—" (NOT "0").
  const toAmountStr =
    toBaseUnitString(estimate.toAmount) ?? toBaseUnitString(raw.toAmount);
  const toAmountMinStr =
    toBaseUnitString(estimate.toAmountMin) ?? toBaseUnitString(raw.toAmountMin);

  const gas = sumGasCosts(estimate.gasCosts);
  const fee = pickFeeCost(estimate.feeCosts);
  const txFormat = detectTxFormat(raw.transactionRequest, fromChainId);
  const txRequest =
    txFormat === "evm"
      ? normalizeTxRequest(raw.transactionRequest, fromChainId)
      : null;
  // Solana source: extract + VALIDATE the serialized transaction from whatever
  // field/encoding the provider used (LI.FI/Mayan vary). The route is executable
  // only when a payload actually deserializes — otherwise it degrades to a quote
  // preview and we log a safe shape summary for diagnosis. Never a raw payload.
  let solanaTransactionData: string | null = null;
  let solanaTransactionSourceField: string | null = null;
  let solanaTransactionFormat: "versioned" | "legacy" | null = null;
  let solanaTransactionByteLength: number | null = null;
  // True when the provider returned a route that needs a separate Solana tx
  // BUILD step (instruction bundle / unsigned-tx object) rather than a signed-
  // ready serialized transaction — distinct from "no payload at all".
  let solanaRequiresBuild = false;
  // True when a payload string WAS present and decoded to bytes, but no
  // deserializer (versioned/legacy) accepted it in any encoding.
  let solanaPayloadUndeserializable = false;
  if (txFormat === "solana") {
    // SINGLE SOURCE OF TRUTH for Solana executability: search the whole quote
    // with the same extractor the executor uses. If it can't produce a
    // deserializable tx, the route is NOT executable — full stop.
    const extraction = extractSolanaTxFromQuote(raw);
    if (extraction.ok) {
      solanaTransactionData = extraction.serializedBase64;
      solanaTransactionSourceField = extraction.sourceField;
      solanaTransactionFormat = extraction.format;
      solanaTransactionByteLength = extraction.byteLength;
    } else {
      solanaRequiresBuild = extraction.requiresBuild;
      solanaPayloadUndeserializable =
        extraction.shapeSummary.decodedByteLength != null;
      logSolanaInvalidTx(extraction.shapeSummary, "quote");
    }
  }

  // TRON source: extract the provider's raw_data_hex (LI.FI returns it in the
  // EVM-looking `data` field). The route is executable only when a TRON tx body
  // actually surfaces — otherwise it degrades to a quote preview. Never a raw
  // provider payload; the executor signs THIS exact hex.
  let tronTransactionData: string | null = null;
  let tronTransactionSourceField: string | null = null;
  let tronTransactionShape: string | null = null;
  let tronFromAddress: string | null = null;
  let tronFeeLimit: string | null = null;
  // True when the provider returned a TRON route that needs a separate build step
  // (unsigned-build object) rather than a ready raw_data_hex.
  let tronRequiresBuild = false;
  if (txFormat === "tron") {
    const extraction = extractTronTransactionRequest(raw);
    if (extraction.ok) {
      tronTransactionData = extraction.rawDataHex;
      tronTransactionSourceField = extraction.sourceField;
      tronTransactionShape = extraction.txShape;
      tronFromAddress = extraction.fromAddress;
      tronFeeLimit = extraction.feeLimit;
    } else {
      tronRequiresBuild = extraction.requiresBuild;
      logTronInvalidTx(extraction.shapeSummary, "quote");
    }
  }
  // TRON-source TRC-20 routes expose an approvalAddress when the bridge contract
  // must be approved to spend the source token first. EVM allowance code is never
  // reused for TRON — the UI checks the live TRC-20 allowance instead.
  const tronNeedsApproval =
    txFormat === "tron" && typeof estimate.approvalAddress === "string";

  // A route is executable only when the gateway didn't flag it quote-only AND:
  //   • EVM:    an EVM tx request came back and the source chain is signable, OR
  //   • Solana: the source is the LI.FI Solana chain, the format is "solana",
  //             and serialized transaction data is present.
  // Any other VM (e.g. TRON) is never executable here.
  const flaggedQuoteOnly =
    (typeof raw.executionStatus === "string" &&
      raw.executionStatus.toLowerCase() === "quoteonly") ||
    raw.executable === false;
  const evmExecutable =
    !flaggedQuoteOnly && txRequest !== null && isSignableSourceChain(fromChainId);
  const solanaExecutable =
    !flaggedQuoteOnly &&
    fromChainId === LIFI_SOLANA_CHAIN_ID &&
    txFormat === "solana" &&
    solanaTransactionData !== null;
  // TRON: the signable raw_data_hex is the SOURCE OF TRUTH for executability.
  //
  // The Simpl gateway returns a TRON-source route WITH an extractable raw_data_hex
  // (transactionRequest.data, leading 0a, ~2730 hex chars) while ALSO stamping it
  // executionStatus:"quoteOnly" / executable:false — an inconsistent normalization
  // (it hands us a transaction we can sign, then labels it preview-only). Honoring
  // that SOFT quote-only flag is what kept TRON→Solana stuck on "Execution coming
  // soon" even with the from-format fix.
  //
  // So for TRON we IGNORE the soft quote-only flag when a signable tx is present,
  // and keep the route preview ONLY when the gateway HARD-marks it "unsupported"
  // or no raw_data_hex came back. EVM / Solana keep honoring flaggedQuoteOnly
  // unchanged. The from-address must be a TRON form (or omitted); the authoritative
  // signer-match against the active account is re-enforced at execution time in
  // executeTronBridgeTransaction (and TRX-for-fees is gated there too).
  const gatewayHardUnsupported =
    typeof raw.executionStatus === "string" &&
    raw.executionStatus.toLowerCase() === "unsupported";
  const tronFromAccepted = isTronSourceAddressForm(tronFromAddress);
  const tronDataEnabled =
    fromChainId === LIFI_TRON_CHAIN_ID &&
    txFormat === "tron" &&
    tronTransactionData !== null &&
    tronFromAccepted;
  const tronExecutable = tronDataEnabled && !gatewayHardUnsupported;
  const executable = evmExecutable || solanaExecutable || tronExecutable;

  // Derive a coarse, display-safe execution status + reason. "unsupported" is
  // reserved for a tx format the wallet can never sign (e.g. TRON / unknown VM);
  // a valid quote we simply can't sign right now is "quoteOnly".
  let executionStatus: BridgeQuote["executionStatus"];
  let executionReason: string;
  if (executable) {
    executionStatus = "executable";
    executionReason =
      txFormat === "solana"
        ? "Executable Solana transaction."
        : txFormat === "tron"
          ? "Executable TRON transaction."
          : "Executable EVM transaction.";
  } else if (txFormat === "other") {
    executionStatus = "unsupported";
    executionReason = "This route's transaction format isn't supported yet.";
  } else if (txFormat === "tron") {
    // Non-executable TRON source. Either the provider needs a build step we don't
    // implement, or it returned no signable raw_data_hex / the gateway flagged the
    // route preview-only. Always honest, TRON-specific copy — never the generic
    // "execution not supported" line, which read as "the whole feature is broken".
    if (tronTransactionData === null && tronRequiresBuild) {
      executionStatus = "unsupported";
      executionReason =
        "Provider route requires TRON transaction build support not implemented yet.";
    } else if (gatewayHardUnsupported) {
      // Gateway/provider explicitly says this TRON route can't be executed.
      executionStatus = "unsupported";
      executionReason = "This TRON route is not available yet.";
    } else {
      // No signable raw_data_hex came back (transactionRequest missing) — a real
      // preview. A route WITH raw_data_hex is now executable above, so this branch
      // is only reached when the provider genuinely returned no TRON tx.
      executionStatus = "quoteOnly";
      executionReason =
        "TRON source execution is not available for this route yet.";
    }
  } else if (txFormat === "solana" && solanaTransactionData === null) {
    if (solanaRequiresBuild) {
      executionStatus = "unsupported";
      executionReason =
        "Provider route requires Solana transaction build support not implemented yet.";
    } else if (solanaPayloadUndeserializable) {
      executionStatus = "unsupported";
      executionReason =
        "Provider returned a Solana transaction payload Simpl cannot deserialize yet.";
    } else {
      executionStatus = "quoteOnly";
      executionReason = "Provider returned no valid Solana transaction payload.";
    }
  } else {
    executionStatus = "quoteOnly";
    executionReason = "Route found, execution is not supported yet.";
  }

  // Definitive TRON executability trace (safe metadata only, behind
  // simpl.debug.bridge): shows EXACTLY what the gateway sent vs. what the app
  // decided, so a future quoteOnly regression can be pinned to the gateway flag,
  // the from-form, or the data extraction in one line.
  if (txFormat === "tron") {
    const rawAny = raw as { executionStatus?: unknown; executionReason?: unknown };
    lifiShapeLog("tron-executable-gate", {
      fromChainId,
      toChainId,
      sourceChainType: bridgeChainType(fromChainId),
      destinationChainType,
      txFormat,
      hasTransactionRequest: raw.transactionRequest != null,
      hasTronTransactionData: tronTransactionData !== null,
      transactionSourceField: tronTransactionSourceField,
      rawDataHexLength: tronTransactionData ? tronTransactionData.length : null,
      tronFromAddressForm: tronFromAddressFormLabel(tronFromAddress),
      tronFromAccepted,
      gatewayExecutionStatus:
        typeof rawAny.executionStatus === "string" ? rawAny.executionStatus : null,
      gatewayExecutionReason:
        typeof rawAny.executionReason === "string" ? rawAny.executionReason : null,
      gatewayExecutable:
        typeof raw.executable === "boolean" ? raw.executable : null,
      flaggedQuoteOnly,
      dataEnabled: tronDataEnabled,
      tronExecutable,
      finalExecutable: executable,
      finalExecutionStatus: executionStatus,
      finalExecutionReason: executionReason,
    });
  }

  return {
    fromChainId,
    toChainId,
    fromTokenSymbol: action.fromToken?.symbol ?? "",
    fromTokenDecimals: action.fromToken?.decimals ?? 18,
    toTokenSymbol,
    toTokenDecimals,
    fromAmountBaseUnits: toBaseUnitString(estimate.fromAmount) ?? "0",
    // "" (not "0") when the provider gave no amount → UI shows "—". A real "0"
    // from the provider is preserved as "0".
    toAmountBaseUnits: toAmountStr ?? "",
    toAmountMinBaseUnits: toAmountMinStr,
    toolName: raw.toolDetails?.name ?? raw.tool ?? "Bridge",
    toolKey: raw.toolDetails?.key ?? raw.tool ?? null,
    gasCostBaseUnits: gas.amount,
    gasCostSymbol: gas.symbol,
    gasCostDecimals: gas.decimals,
    feeCostBaseUnits: fee.amount,
    feeCostSymbol: fee.symbol,
    feeCostDecimals: fee.decimals,
    slippage: typeof action.slippage === "number" ? action.slippage : null,
    estimatedDurationSeconds:
      typeof estimate.executionDuration === "number"
        ? estimate.executionDuration
        : null,
    approvalAddress: resolveApprovalAddress(raw),
    transactionRequest: txRequest,
    txFormat,
    solanaTransactionData,
    solanaTransactionSourceField,
    solanaTransactionFormat,
    solanaTransactionByteLength,
    tronTransactionData,
    tronTransactionSourceField,
    tronTransactionShape,
    tronFromAddress,
    tronFeeLimit,
    tronNeedsApproval,
    executable,
    executionStatus,
    executionReason,
    sourceChainType: bridgeChainType(fromChainId),
    destinationChainType,
  };
}

// Thrown when the gateway has no route for the requested pair (HTTP 404 / a
// "no route"/"not found" body). The UI renders a friendly empty state for it.
export class NoBridgeRouteError extends Error {
  // Stable classification code: a genuine "no route for this pair/amount". The UI
  // probes higher amounts (stablecoins) to tell a too-small amount apart from a
  // truly unsupported pair.
  readonly code = "NO_ROUTE" as const;
  constructor(message = "No route found for this pair.") {
    super(message);
    this.name = "NoBridgeRouteError";
  }
}

// A classified, NON-RETRYABLE quote failure (a 4xx the gateway/provider won't
// satisfy on a re-POST with the same inputs). `message` is already display-safe.
export type BridgeQuoteErrorCode =
  | "unsupportedTronRoute"
  | "invalidDestination"
  | "invalidToken"
  | "amountTooLow"
  | "NO_ROUTE"
  | "failed";

export class BridgeQuoteError extends Error {
  readonly code: BridgeQuoteErrorCode;
  readonly status: number | null;
  constructor(code: BridgeQuoteErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "BridgeQuoteError";
    this.code = code;
    this.status = status;
  }
}

// Extract a safe, value-free view of the gateway's error body for diagnostics
// (never raw tx/signatures — the gateway never returns those, but we still cap +
// pick known fields). JSON fields when present, else the first 500 chars of text.
function safeErrorBody(err: BridgeHttpError): Record<string, unknown> {
  const body = err.bodyJson;
  if (body) {
    return {
      status: err.status,
      errorCode: body.code ?? body.errorCode ?? null,
      message: typeof body.message === "string" ? body.message.slice(0, 300) : null,
      error: typeof body.error === "string" ? body.error.slice(0, 200) : null,
      details: typeof body.details === "string" ? body.details.slice(0, 300) : body.details ?? null,
      validationErrors: body.validationErrors ?? body.errors ?? null,
      providerErrorCode: body.providerErrorCode ?? null,
      providerMessage:
        typeof body.providerMessage === "string"
          ? body.providerMessage.slice(0, 300)
          : null,
    };
  }
  return {
    status: err.status,
    message: null,
    text: err.bodyText ? err.bodyText.slice(0, 500) : null,
  };
}

// Classify a gateway HTTP error into a precise, non-retryable BridgeQuoteError —
// or NoBridgeRouteError for a genuine "no route". Reads the gateway/provider's own
// message; order matters (most specific first). The TRON-as-EVM gateway rejection
// ("chain <id> is EVM, expected an EVM (0x) address") means TRON isn't supported
// by the proxy yet — a stable "not available yet", never a retry loop.
function classifyQuoteError(
  err: BridgeHttpError,
  params: BridgeQuoteParams,
): NoBridgeRouteError | BridgeQuoteError {
  // Prefer the gateway's normalized error contract when it gives a stable code.
  // This surfaces clean, safe copy for the hardened codes (rate limit, provider
  // timeout/unavailable, quote expiry, insufficient liquidity, unsupported
  // asset) without changing control flow — a classified BridgeQuoteError still
  // blocks the confirm button, which is exactly what we want for a rate limit
  // (no aggressive auto-retry). BAD_REQUEST/validation fall through to the
  // precise TRON/token/amount text matching below.
  const normalized = normalizeApiErrorBody(err.bodyJson ?? err.bodyText, err.status);
  switch (normalized.code) {
    case "NO_ROUTE":
    case "INSUFFICIENT_LIQUIDITY":
      return new NoBridgeRouteError();
    case "RATE_LIMITED":
    case "UPSTREAM_TIMEOUT":
    case "PROVIDER_TIMEOUT":
    case "UPSTREAM_UNAVAILABLE":
    case "QUOTE_EXPIRED":
    case "PROVIDER_ERROR":
      return new BridgeQuoteError("failed", normalized.userMessage, err.status);
    case "UNSUPPORTED_ASSET":
    case "UNSUPPORTED_TOKEN":
    case "INVALID_TOKEN":
      return new BridgeQuoteError("invalidToken", normalized.userMessage, err.status);
    case "UNSUPPORTED_CHAIN":
      return new BridgeQuoteError("failed", normalized.userMessage, err.status);
    default:
      break; // fall through to the legacy, more specific text matching
  }

  const body = err.bodyJson ?? {};
  const msg = (
    (typeof body.message === "string" ? body.message : "") +
    " " +
    (typeof body.error === "string" ? body.error : "") +
    " " +
    (err.bodyText ?? "")
  ).toLowerCase();
  const tronInvolved =
    params.fromChainId === LIFI_TRON_CHAIN_ID ||
    params.toChainId === LIFI_TRON_CHAIN_ID;

  if (err.status === 404 || msg.includes("no route") || msg.includes("not found")) {
    return new NoBridgeRouteError();
  }
  // Gateway rejects the TRON address because its chain-type table treats TRON as
  // EVM — the proxy does not support TRON routes yet. Stable unsupported message.
  if (
    tronInvolved &&
    (msg.includes("is evm, expected an evm") ||
      msg.includes("expected an evm") ||
      (msg.includes("address") && msg.includes("invalid")))
  ) {
    return new BridgeQuoteError(
      "unsupportedTronRoute",
      "This TRON route is not available yet.",
      err.status,
    );
  }
  if (msg.includes("toaddress") && msg.includes("invalid")) {
    return new BridgeQuoteError(
      "invalidDestination",
      "TRON destination address is invalid.",
      err.status,
    );
  }
  if (
    (msg.includes("token") || msg.includes("totoken") || msg.includes("fromtoken")) &&
    (msg.includes("invalid") || msg.includes("not supported") || msg.includes("unsupported"))
  ) {
    return new BridgeQuoteError(
      "invalidToken",
      "This TRON token is not supported for bridging.",
      err.status,
    );
  }
  if (
    msg.includes("amount") &&
    (msg.includes("too low") ||
      msg.includes("too small") ||
      msg.includes("minimum") ||
      msg.includes("min amount") ||
      msg.includes("below"))
  ) {
    return new BridgeQuoteError(
      "amountTooLow",
      "Amount is too small for this bridge route.",
      err.status,
    );
  }
  return new BridgeQuoteError("failed", "Could not get a bridge quote.", err.status);
}

export async function getBridgeQuote(
  params: BridgeQuoteParams,
): Promise<BridgeQuote> {
  // The production Simpl gateway route is POST /v1/bridge/lifi/quote with a JSON
  // body (NOT a GET query). The gateway injects the integrator/referral/API key
  // server-side — nothing sensitive is sent or returned to the client.
  /**
   * Production fees are backend-authoritative. The extension must display the
   * fee breakdown returned by getsimpl-api and must NOT override the bridge
   * integrator or fee client-side. The gateway injects integrator/fee/API-key
   * server-side, so the client sends NEITHER `integrator` NOR `fee`.
   */
  const body: Record<string, unknown> = {
    fromChain: params.fromChainId,
    toChain: params.toChainId,
    fromToken: params.fromTokenAddress,
    toToken: params.toTokenAddress,
    fromAmount: params.fromAmountBaseUnits,
    fromAddress: params.fromAddress,
  };
  if (params.toAddress) {
    body.toAddress = params.toAddress;
  }
  if (params.slippageBps != null) {
    // Slippage as a decimal fraction (0.005 = 0.5%).
    body.slippage = params.slippageBps / 10_000;
  }
  if (params.order) {
    body.order = params.order;
  }
  if (params.allowBridges?.length) body.allowBridges = params.allowBridges;
  if (params.denyBridges?.length) body.denyBridges = params.denyBridges;
  if (params.allowExchanges?.length) body.allowExchanges = params.allowExchanges;
  if (params.denyExchanges?.length) body.denyExchanges = params.denyExchanges;

  // Structured request diagnostics — chains, token addresses and ADDRESS TYPES
  // only (never the raw addresses, never secrets/headers).
  bridgeDebugLog("quote:request", {
    fromChain: params.fromChainId,
    toChain: params.toChainId,
    sourceChainType: bridgeChainType(params.fromChainId),
    destinationChainType: bridgeChainType(params.toChainId),
    fromToken: params.fromTokenAddress,
    toToken: params.toTokenAddress,
    fromAddressType: classifyAddressType(params.fromAddress),
    toAddressType: classifyAddressType(params.toAddress),
    // Fee/integrator are injected server-side by getsimpl-api (backend-authoritative);
    // the client sends none.
  });

  // Safe request shape — the exact (masked) inputs that produced the quote, so a
  // gateway 4xx can be diagnosed without the raw addresses leaving the device.
  lifiShapeLog("quote-request-safe", {
    fromChain: params.fromChainId,
    toChain: params.toChainId,
    sourceChainType: bridgeChainType(params.fromChainId),
    destinationChainType: bridgeChainType(params.toChainId),
    fromTokenSymbol: params.fromTokenSymbol ?? null,
    fromTokenAddress: params.fromTokenAddress,
    toTokenSymbol: params.toTokenSymbol ?? null,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmountBaseUnits,
    fromAmountDecimals: params.fromTokenDecimals ?? null,
    fromAddressType: classifyAddressType(params.fromAddress),
    toAddressType: classifyAddressType(params.toAddress),
    fromAddressValid: isValidAddressForChain(params.fromAddress, params.fromChainId),
    toAddressValid: params.toAddress
      ? isValidAddressForChain(params.toAddress, params.toChainId)
      : null,
    fromAddressMasked: maskAddressForDebug(params.fromAddress),
    toAddressMasked: maskAddressForDebug(params.toAddress),
    slippageBps: params.slippageBps ?? null,
  });

  let raw: RawBridgeQuote;
  try {
    raw = await fetchJson<RawBridgeQuote>(
      // Opt into the getsimpl-api v2 normalized response (backend still returns
      // the legacy shape until deployed; the parser handles both).
      `${API_BASE_URL}/v1/bridge/lifi/quote?format=v2`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    bridgeDebugLog("quote:error", {
      fromChain: params.fromChainId,
      toChain: params.toChainId,
    });
    // Preserve + surface the gateway's own safe error body, then classify into a
    // precise, NON-RETRYABLE reason (TRON-unsupported / invalid token / amount
    // too low / …). A 404 / "no route" maps to the friendly empty state.
    if (error instanceof BridgeHttpError) {
      lifiShapeLog("quote-error-body", safeErrorBody(error));
      throw classifyQuoteError(error, params);
    }
    throw error;
  }

  // Raw-response shape diagnostics BEFORE normalization (safe metadata only).
  lastRawQuoteShape = summarizeRawQuoteShape(raw);
  lifiShapeLog("quote-shape", {
    fromChain: params.fromChainId,
    toChain: params.toChainId,
    sourceChainType: bridgeChainType(params.fromChainId),
    ...lastRawQuoteShape,
  });

  if (!raw || (!raw.estimate && !raw.transactionRequest)) {
    bridgeDebugLog("quote:no-route", {
      fromChain: params.fromChainId,
      toChain: params.toChainId,
    });
    throw new NoBridgeRouteError();
  }

  const quote = normalizeQuote(raw);

  bridgeDebugLog("quote:result", {
    fromChain: quote.fromChainId,
    toChain: quote.toChainId,
    sourceChainType: quote.sourceChainType,
    destinationChainType: quote.destinationChainType,
    hasTransactionRequest: raw.transactionRequest != null,
    txFormat: quote.txFormat,
    executable: quote.executable,
    executionStatus: quote.executionStatus,
    executionReason: quote.executionReason,
    tool: quote.toolKey,
  });

  return quote;
}

// ── Low-amount route probing ────────────────────────────────────────────────
//
// Cross-chain bridges (esp. intent-based routes like NearIntents) enforce a
// minimum input amount; below it the gateway returns a plain "no route", which is
// indistinguishable from a genuinely unsupported pair. After a NO_ROUTE on a
// stablecoin route we re-quote the SAME pair at a few standard amounts to find the
// smallest that DOES route, so the UI can say "try at least N" instead of a dead
// end. Results are cached per route so we never re-probe on every render.

// Stablecoins we probe (and compare value against) — all ≈ $1, so the input
// amount IS the USD value, no price oracle needed.
const STABLECOIN_SYMBOLS = new Set([
  "USDT",
  "USDC",
  "USDC.E",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDD",
  "BUSD",
  "USDP",
]);

export function isStablecoinSymbol(symbol: string | null | undefined): boolean {
  return symbol != null && STABLECOIN_SYMBOLS.has(symbol.trim().toUpperCase());
}

// Standard probe amounts (whole stablecoin units), smallest first.
const PROBE_AMOUNTS = [3, 5, 10] as const;

export type BridgeMinimumProbe = {
  // Smallest probed amount that routed, in source base units + whole units.
  minBaseUnits: string;
  minWholeAmount: number;
};

// Cache: route key → probe result (or null when no probe amount routed). Keyed by
// chains + tokens + source decimals + slippage, NOT the failing amount, so all
// amounts for a route share one probe.
const probeCache = new Map<string, BridgeMinimumProbe | null>();

function probeCacheKey(params: {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  sourceDecimals: number;
  slippageBps?: number;
}): string {
  return [
    params.fromChainId,
    params.toChainId,
    params.fromTokenAddress.toLowerCase(),
    params.toTokenAddress.toLowerCase(),
    params.sourceDecimals,
    params.slippageBps ?? "default",
  ].join("|");
}

// Probe the smallest standard amount that routes for a stablecoin pair, after a
// NO_ROUTE on the user's amount. Returns null for non-stablecoin sources or when
// even the largest probe doesn't route. Cached per route; never re-probes. The
// extra quote calls reuse getBridgeQuote (so they share the safe diagnostics).
export async function probeMinimumBridgeAmount(params: {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAddress: string;
  toAddress?: string;
  slippageBps?: number;
  sourceDecimals: number;
  sourceSymbol: string;
}): Promise<BridgeMinimumProbe | null> {
  if (!isStablecoinSymbol(params.sourceSymbol)) return null;

  const key = probeCacheKey(params);
  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;

  let result: BridgeMinimumProbe | null = null;
  for (const whole of PROBE_AMOUNTS) {
    const base = (
      BigInt(whole) *
      10n ** BigInt(params.sourceDecimals)
    ).toString();
    try {
      await getBridgeQuote({
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        fromTokenAddress: params.fromTokenAddress,
        toTokenAddress: params.toTokenAddress,
        fromAmountBaseUnits: base,
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        slippageBps: params.slippageBps,
        fromTokenSymbol: params.sourceSymbol,
        fromTokenDecimals: params.sourceDecimals,
      });
      // A resolved quote means a route EXISTS at this amount.
      result = { minBaseUnits: base, minWholeAmount: whole };
      lifiShapeLog("probe", { whole, routed: true });
      break;
    } catch (error) {
      // Still too small / no route → try the next amount. Any OTHER failure
      // (network, unsupported, invalid token) is not an amount problem → stop.
      const isAmountOrNoRoute =
        error instanceof NoBridgeRouteError ||
        (error instanceof BridgeQuoteError &&
          (error.code === "NO_ROUTE" || error.code === "amountTooLow"));
      lifiShapeLog("probe", {
        whole,
        routed: false,
        stop: !isAmountOrNoRoute,
      });
      if (!isAmountOrNoRoute) break;
    }
  }

  probeCache.set(key, result);
  return result;
}

// ── Prepare (refresh-before-sign) ───────────────────────────────────────────
//
// A bridge route's transaction is built at quote time, so it can go stale before
// the user confirms: an EVM route's calldata can be outdated and — more acutely —
// a Solana route embeds a recent blockhash + lastValidBlockHeight that expires
// within ~60–90s. prepareBridgeTransaction() re-derives a FRESH executable route
// immediately before signing so the wallet never broadcasts a stale transaction.
//
// It currently reuses getBridgeQuote() (the gateway has no separate build step),
// but is the single, typed choke point the UI calls right before signing. It
// also guards against a materially different result: if the refreshed output /
// minimum-received moved beyond the caller's tolerance, it returns the fresh
// quote WITHOUT an ok:true so the UI can show the updated numbers instead of
// silently signing something the user didn't review.

export type BridgePrepareParams = BridgeQuoteParams & {
  // The amounts the user last reviewed, for material-change detection. When
  // absent, no change check is performed (first prepare).
  previousToAmountBaseUnits?: string | null;
  previousToAmountMinBaseUnits?: string | null;
  // Allowed drift in the destination amount before we force a re-review, in
  // basis points (default 1%). Either an increase or a decrease beyond this is
  // surfaced — we never silently change the user-visible To amount.
  toleranceBps?: number;
};

export type BridgePrepareResult =
  // Fresh, executable, within tolerance → safe to sign `quote` right now.
  | { ok: true; quote: BridgeQuote }
  // Executable, but the refreshed amount drifted beyond tolerance → show the
  // updated `quote` and require an explicit re-confirm.
  | { ok: false; code: "materialChange"; quote: BridgeQuote; message: string }
  // Route is still valid but not signable (e.g. provider returned no tx) → show
  // the updated `quote` so the status flips to Quote only / Unsupported.
  | { ok: false; code: "quoteOnly" | "unsupported"; quote: BridgeQuote; message: string }
  // No route for the pair, or the refresh itself failed → no usable quote.
  | { ok: false; code: "noRoute" | "failed"; message: string };

// True when `next` differs from `prev` by more than `bps` basis points. A null
// baseline (or unparseable value) is treated as "no change" so a first prepare
// never trips the guard.
function exceedsTolerance(
  prev: string | null | undefined,
  next: string | null | undefined,
  bps: number,
): boolean {
  if (prev == null || next == null) return false;
  let prevUnits: bigint;
  let nextUnits: bigint;
  try {
    prevUnits = BigInt(prev);
    nextUnits = BigInt(next);
  } catch {
    return false;
  }
  if (prevUnits === 0n) return nextUnits !== 0n;
  const diff = nextUnits > prevUnits ? nextUnits - prevUnits : prevUnits - nextUnits;
  // diff / prev > bps / 10000  ⇔  diff * 10000 > prev * bps  (integer-safe)
  return diff * 10_000n > prevUnits * BigInt(bps);
}

export async function prepareBridgeTransaction(
  params: BridgePrepareParams,
): Promise<BridgePrepareResult> {
  const {
    previousToAmountBaseUnits,
    previousToAmountMinBaseUnits,
    toleranceBps = 100,
    ...quoteParams
  } = params;

  let quote: BridgeQuote;
  try {
    quote = await getBridgeQuote(quoteParams);
  } catch (error) {
    if (error instanceof NoBridgeRouteError) {
      return { ok: false, code: "noRoute", message: "No route found for this pair." };
    }
    bridgeDebugLog("prepare:error", {
      fromChain: params.fromChainId,
      toChain: params.toChainId,
    });
    return {
      ok: false,
      code: "failed",
      // Surface a classified quote reason (e.g. "This TRON route is not available
      // yet.") rather than a generic line when the gateway gave one.
      message:
        error instanceof BridgeQuoteError
          ? error.message
          : "Could not refresh this route. Try again.",
    };
  }

  bridgeDebugLog("prepare:result", {
    fromChain: quote.fromChainId,
    toChain: quote.toChainId,
    sourceChainType: quote.sourceChainType,
    txFormat: quote.txFormat,
    executionStatus: quote.executionStatus,
    hasTransactionRequest:
      quote.transactionRequest != null || quote.solanaTransactionData != null,
  });

  if (quote.executionStatus === "unsupported") {
    return { ok: false, code: "unsupported", quote, message: quote.executionReason };
  }
  if (!quote.executable || quote.executionStatus === "quoteOnly") {
    return { ok: false, code: "quoteOnly", quote, message: quote.executionReason };
  }

  const changed =
    exceedsTolerance(
      previousToAmountBaseUnits,
      quote.toAmountBaseUnits,
      toleranceBps,
    ) ||
    exceedsTolerance(
      previousToAmountMinBaseUnits,
      quote.toAmountMinBaseUnits,
      toleranceBps,
    );
  if (changed) {
    return {
      ok: false,
      code: "materialChange",
      quote,
      message: "The quote changed. Review the updated amount and confirm again.",
    };
  }

  return { ok: true, quote };
}

// ── Status ────────────────────────────────────────────────────────────────

export type BridgeStatus = "PENDING" | "DONE" | "FAILED" | "NOT_FOUND";

export type BridgeStatusResult = {
  status: BridgeStatus;
  // Destination-chain receiving tx hash once the bridge completes, if exposed.
  receivingTxHash: string | null;
};

export async function getBridgeStatus(params: {
  txHash: string;
  fromChainId: number;
  toChainId: number;
  bridgeKey?: string | null;
}): Promise<BridgeStatusResult> {
  const search = new URLSearchParams({
    txHash: params.txHash,
    fromChain: String(params.fromChainId),
    toChain: String(params.toChainId),
  });
  if (params.bridgeKey) {
    search.set("bridge", params.bridgeKey);
  }
  search.set("format", "v2");

  const raw = await fetchJson<{
    status?: string;
    receiving?: { txHash?: string } | null;
  }>(`${API_BASE_URL}/v1/bridge/lifi/status?${search.toString()}`);

  const status = (raw?.status ?? "PENDING").toUpperCase();
  const normalized: BridgeStatus =
    status === "DONE" || status === "FAILED" || status === "NOT_FOUND"
      ? (status as BridgeStatus)
      : "PENDING";

  return {
    status: normalized,
    receivingTxHash: raw?.receiving?.txHash ?? null,
  };
}

// ── On-chain reads ──────────────────────────────────────────────────────────
//
// The low-level allowance/balance reads live in the chain-balance service (the
// single place the app reads on-chain token balances). They're re-exported here
// so the bridge flow can keep importing them from one module.

export {
  readErc20Allowance,
  readErc20Balance,
  readNativeBalance,
} from "../balances/chain-balance.service";
