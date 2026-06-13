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
  // Serialized Solana transaction (base64) — present only when txFormat is
  // "solana" and the gateway supplied it. Never a raw provider payload.
  solanaTransactionData: string | null;
  // True when the wallet can sign + send this route locally right now.
  executable: boolean;
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
};

type RawBridgeQuote = {
  // Simpl proxy may stamp this to flag a non-executable preview.
  executionStatus?: string;
  executable?: boolean;
  tool?: string;
  toolDetails?: { key?: string; name?: string } | null;
  action?: {
    fromToken?: { symbol?: string; decimals?: number } | null;
    toToken?: { symbol?: string; decimals?: number } | null;
    fromChainId?: number;
    toChainId?: number;
    slippage?: number;
  } | null;
  estimate?: {
    fromAmount?: string;
    toAmount?: string;
    toAmountMin?: string;
    approvalAddress?: string;
    executionDuration?: number;
    gasCosts?: RawGasCost[];
    feeCosts?: RawFeeCost[];
  } | null;
  transactionRequest?: RawTxRequest | null;
};

// Convert a possibly-hex (0x…) or decimal numeric string to a decimal base-unit
// string. Returns null when it can't be parsed.
function toBaseUnitString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return BigInt(value).toString();
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
// gateway's explicit `format` hint and falls back to inferring EVM from an EVM
// tx shape. TRON / unknown VMs are "other" → never executable here.
function detectTxFormat(
  raw: RawTxRequest | null | undefined,
): "evm" | "solana" | "other" {
  if (!raw) return "other";
  const fmt = typeof raw.format === "string" ? raw.format.toLowerCase() : "";
  if (fmt === "solana" || fmt === "svm") return "solana";
  if (fmt === "evm") return "evm";
  if (fmt) return "other"; // explicit non-evm / tron / etc.
  return typeof raw.to === "string" && typeof raw.data === "string"
    ? "evm"
    : "other";
}

function normalizeQuote(raw: RawBridgeQuote): BridgeQuote {
  const action = raw.action ?? {};
  const estimate = raw.estimate ?? {};
  const fromChainId = action.fromChainId ?? 0;
  const toChainId = action.toChainId ?? 0;

  const gas = sumGasCosts(estimate.gasCosts);
  const fee = pickFeeCost(estimate.feeCosts);
  const txFormat = detectTxFormat(raw.transactionRequest);
  const txRequest =
    txFormat === "evm"
      ? normalizeTxRequest(raw.transactionRequest, fromChainId)
      : null;
  // Serialized Solana transaction string — only when the gateway clearly marks
  // the format as "solana" and supplies data. Never a raw provider payload.
  const solanaTransactionData =
    txFormat === "solana" &&
    typeof raw.transactionRequest?.data === "string" &&
    raw.transactionRequest.data.length > 0
      ? raw.transactionRequest.data
      : null;

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

  return {
    fromChainId,
    toChainId,
    fromTokenSymbol: action.fromToken?.symbol ?? "",
    fromTokenDecimals: action.fromToken?.decimals ?? 18,
    toTokenSymbol: action.toToken?.symbol ?? "",
    toTokenDecimals: action.toToken?.decimals ?? 18,
    fromAmountBaseUnits: toBaseUnitString(estimate.fromAmount) ?? "0",
    toAmountBaseUnits: toBaseUnitString(estimate.toAmount) ?? "0",
    toAmountMinBaseUnits: toBaseUnitString(estimate.toAmountMin),
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
    executable,
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
    // A 404 from the gateway means "no route" — surface the friendly variant.
    if (/\b404\b/u.test(message) || /not\s*found/iu.test(message)) {
      throw new NoBridgeRouteError();
    }
    throw error;
  }

  if (!raw || (!raw.estimate && !raw.transactionRequest)) {
    throw new NoBridgeRouteError();
  }

  return normalizeQuote(raw);
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
