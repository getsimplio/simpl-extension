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
import {
  extractSerializedSolanaTransaction,
  isBridgeDebugEnabled,
  logSolanaInvalidTx,
  type SolanaTxShapeSummary,
} from "../../chains/solana/solana.bridge";

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
          data: shapeOf(txReq.data),
          serializedTransaction: shapeOf(txReq.serializedTransaction),
          transaction: shapeOf(txReq.transaction),
          tx: shapeOf(txReq.tx),
          rawTransaction: shapeOf(txReq.rawTransaction),
          swapTransaction: shapeOf(txReq.swapTransaction),
          instructions: shapeOf(txReq.instructions),
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
        }
      : null,
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
// can log "fromAddress type" safely.
export function classifyAddressType(
  address: string | null | undefined,
): "evm" | "solana" | "none" | "unknown" {
  if (!address) return "none";
  if (/^0x[0-9a-fA-F]{40}$/u.test(address)) return "evm";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(address)) return "solana";
  return "unknown";
}

// EVM vs SVM family for the supported production chain set (Solana is the only
// non-EVM source/destination the bridge offers; everything else is EVM).
export function bridgeChainType(chainId: number): "EVM" | "SVM" {
  return chainId === LIFI_SOLANA_CHAIN_ID ? "SVM" : "EVM";
}

const DEFAULT_TIMEOUT_MS = 20_000;

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
      throw new Error(`${response.status} ${response.statusText}`);
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
};

// An EVM transaction the wallet can sign + send for an executable route. Only
// the fields the send pipeline needs are kept — never the raw provider object.
export type BridgeTransactionRequest = {
  to: string;
  data: string;
  value: string;
  chainId: number;
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
  // "solana" (serialized SVM transaction), or "other" (unsupported VM).
  txFormat: "evm" | "solana" | "other";
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
  sourceChainType: "EVM" | "SVM";
  destinationChainType: "EVM" | "SVM";
};

// LI.FI's Solana (SVM) chain id. Used to detect Solana-source routes.
export const LIFI_SOLANA_CHAIN_ID = 1151111081099710;

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
  // Gateway-normalized format hint: "evm" | "solana" | "non-evm". When absent we
  // infer EVM from the presence of an EVM `to` + `data`.
  format?: string;
  // Solana payload: the gateway returns the serialized SVM transaction here and
  // may also mirror it into `data`. Prefer this field for Solana execution.
  serializedTransaction?: string | null;
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
  return {
    to: raw.to,
    data: raw.data,
    value: raw.value ?? "0",
    chainId: typeof raw.chainId === "number" ? raw.chainId : fallbackChainId,
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
): "evm" | "solana" | "other" {
  const fmt =
    raw && typeof raw.format === "string" ? raw.format.toLowerCase() : "";
  if (fmt === "solana" || fmt === "svm") return "solana";
  if (fmt === "evm") return "evm";
  if (fmt) return "other"; // explicit non-evm / tron / etc.
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
  const toTokenInfo = action.toToken ?? raw.toToken ?? null;
  const toTokenDecimals =
    typeof toTokenInfo?.decimals === "number"
      ? toTokenInfo.decimals
      : destinationChainType === "SVM"
        ? 9
        : 18;
  const toTokenSymbol =
    toTokenInfo?.symbol ?? (destinationChainType === "SVM" ? "SOL" : "");
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
  const executable = evmExecutable || solanaExecutable;

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
        : "Executable EVM transaction.";
  } else if (txFormat === "other") {
    executionStatus = "unsupported";
    executionReason = "This route's transaction format isn't supported yet.";
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
    approvalAddress:
      typeof estimate.approvalAddress === "string"
        ? estimate.approvalAddress
        : null,
    transactionRequest: txRequest,
    txFormat,
    solanaTransactionData,
    solanaTransactionSourceField,
    solanaTransactionFormat,
    solanaTransactionByteLength,
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
  constructor(message = "No route found for this pair.") {
    super(message);
    this.name = "NoBridgeRouteError";
  }
}

export async function getBridgeQuote(
  params: BridgeQuoteParams,
): Promise<BridgeQuote> {
  // The production Simpl gateway route is POST /v1/bridge/lifi/quote with a JSON
  // body (NOT a GET query). The gateway injects the integrator/referral/API key
  // server-side — nothing sensitive is sent or returned to the client.
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
  });

  let raw: RawBridgeQuote;
  try {
    raw = await fetchJson<RawBridgeQuote>(
      `${API_BASE_URL}/v1/bridge/lifi/quote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bridgeDebugLog("quote:error", {
      fromChain: params.fromChainId,
      toChain: params.toChainId,
    });
    // A 404 from the gateway means "no route" — surface the friendly variant.
    if (/\b404\b/u.test(message) || /not\s*found/iu.test(message)) {
      throw new NoBridgeRouteError();
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
      message: "Could not refresh this route. Try again.",
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
