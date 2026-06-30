// src/core/prices/simpl-market-api.service.ts
//
// Thin client for the Simpl API Gateway market-data endpoints. This is the
// SINGLE place the extension talks to for fiat price, 24h change and chart
// data — no extension code calls CoinGecko / DefiLlama / GeckoTerminal directly
// anymore. The gateway fronts those providers server-side (the `source` field
// in every response says which one answered), so no provider API keys ever ship
// in the client.
//
// Balances still come from direct RPC calls (see token-balance.service) — this
// service only ever returns fiat price / chart data, never balances or chain
// state. Swap quotes/prices keep using the dedicated 0x proxy paths in
// zeroXSwapService and are intentionally untouched here.

import {
  BITCOIN_MAINNET_CHAIN_ID,
  BITCOIN_TESTNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  TRON_MAINNET_CHAIN_ID,
  TON_MAINNET_CHAIN_ID,
} from "../networks/chain-registry";
import { NATIVE_ADDRESS, priceDebug, priceWarn } from "./price-identity";

// Resolve the gateway base URL. Prefer the explicit market-data alias, fall
// back to the existing swap-proxy var, then the production gateway. Trailing
// slashes are trimmed so path concatenation stays clean.
function resolveApiBaseUrl(): string {
  const candidate =
    (import.meta.env.VITE_SIMPL_API_URL as string | undefined) ??
    (import.meta.env.VITE_SIMPL_SWAP_PROXY_URL as string | undefined) ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();

// The chainId the gateway expects. EVM chains use their numeric id verbatim;
// the non-EVM chains (which carry synthetic internal ids in this wallet) map to
// the gateway's string slugs. Testnets/devnets get their own slug so the
// gateway can decide market data + total-balance inclusion correctly.
export function toBackendChainId(chainId: number): string {
  switch (chainId) {
    case BITCOIN_MAINNET_CHAIN_ID:
      return "bitcoin";
    case BITCOIN_TESTNET_CHAIN_ID:
      return "bitcoin-testnet";
    case SOLANA_MAINNET_CHAIN_ID:
      return "solana";
    case SOLANA_DEVNET_CHAIN_ID:
      return "solana-devnet";
    case TRON_MAINNET_CHAIN_ID:
      return "tron";
    case TON_MAINNET_CHAIN_ID:
      return "ton";
    default:
      return String(chainId);
  }
}

// Normalize an asset address for the gateway: native marker stays "native",
// contract addresses are lowercased.
function toBackendAddress(address: string | null): string {
  if (!address) return NATIVE_ADDRESS;
  // EVM 0x addresses are case-insensitive (lowercase canonical). Non-EVM base58
  // addresses (Solana SPL mints, TRON) are CASE-SENSITIVE and must never be
  // lowercased — doing so corrupts the mint. Preserve their casing verbatim.
  return /^0x[0-9a-fA-F]{40}$/u.test(address) ? address.toLowerCase() : address;
}

export type VsCurrency = "usd" | "eur";

// Gateway history ranges. The UI's own range labels (1D/7D/1M) are mapped onto
// these by the price-history service.
export type SimplHistoryRange = "1d" | "7d" | "1m" | "3m" | "1y" | "max";

export type SimplSpotPrice = {
  assetId?: string;
  chainId: string;
  address: string;
  symbol?: string;
  name?: string;
  price: number;
  currency: string;
  change24h?: number | null;
  // volume24h / marketCap / marketDataSource / logoUrl are only populated when
  // the request asks for market enrichment (include=market). `source` is the
  // price source; `marketDataSource` is the enrichment source (e.g. coingecko).
  volume24h?: number | null;
  marketCap?: number | null;
  marketDataSource?: string | null;
  logoUrl?: string | null;
  source?: string;
  cached?: boolean;
  updatedAt?: string;
};

export type SimplBatchItem = SimplSpotPrice;

export type SimplBatchResult = {
  currency: string;
  items: SimplBatchItem[];
  errors: unknown[];
};

export type SimplHistoryPoint = { t: number; price: number };

export type SimplHistoryResult = {
  assetId?: string;
  chainId: string;
  address: string;
  symbol?: string;
  range: string;
  currency: string;
  points: SimplHistoryPoint[];
  source?: string;
  cached?: boolean;
  updatedAt?: string;
};

// OHLC candle from /v1/prices/ohlc. `t` is epoch milliseconds.
export type SimplCandlePoint = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SimplOhlcResult = {
  assetId?: string;
  chainId: string;
  address: string;
  symbol?: string;
  range: string;
  currency: string;
  candles: SimplCandlePoint[];
  source?: string;
  cached?: boolean;
  updatedAt?: string;
};

export type SimplAssetResolution = {
  assetId?: string;
  chainId: string;
  address: string;
  symbol?: string;
  name?: string;
  // The gateway's authoritative answer on whether this asset's balance may
  // count toward real portfolio value (mainnet → true, testnet → false).
  includeInTotalBalance?: boolean;
};

export type SimplAssetMetadata = {
  assetId?: string;
  chainId: string;
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoUrl?: string | null;
};

export type SimplAssetRef = {
  chainId: number;
  address: string | null;
};

const DEFAULT_TIMEOUT_MS = 12_000;

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

// GET /v1/prices/spot — single asset spot price (+ 24h change when available).
// Pass includeMarket to also request 24h volume / market cap / logo enrichment
// (`include=market`); without it the gateway returns price-only (volume null).
export async function getSpotPrice(params: {
  chainId: number;
  address: string | null;
  vs?: VsCurrency;
  includeMarket?: boolean;
}): Promise<SimplSpotPrice | null> {
  const vs = params.vs ?? "usd";
  const search = new URLSearchParams({
    chainId: toBackendChainId(params.chainId),
    address: toBackendAddress(params.address),
    vs,
  });
  if (params.includeMarket) {
    search.set("include", "market");
  }
  try {
    return await fetchJson<SimplSpotPrice>(
      `${API_BASE_URL}/v1/prices/spot?${search.toString()}`,
    );
  } catch (error) {
    priceWarn("simpl spot failed", {
      chainId: params.chainId,
      address: params.address,
      vs,
      error: String(error),
    });
    return null;
  }
}

// POST /v1/prices/batch — many assets in one round-trip. Returns the gateway
// envelope; partial provider failures land in `errors` while `items` still
// holds whatever resolved, so callers should render what they got.
export async function getBatchPrices(
  assets: SimplAssetRef[],
  vs: VsCurrency = "usd",
): Promise<SimplBatchResult | null> {
  if (assets.length === 0) {
    return { currency: vs, items: [], errors: [] };
  }
  const body = {
    vs,
    assets: assets.map((a) => ({
      chainId: toBackendChainId(a.chainId),
      address: toBackendAddress(a.address),
    })),
  };
  try {
    return await fetchJson<SimplBatchResult>(`${API_BASE_URL}/v1/prices/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    priceWarn("simpl batch failed", {
      count: assets.length,
      vs,
      error: String(error),
    });
    return null;
  }
}

// GET /v1/prices/history — chart points for one asset over a range.
export async function getPriceHistory(params: {
  chainId: number;
  address: string | null;
  range: SimplHistoryRange;
  vs?: VsCurrency;
}): Promise<SimplHistoryResult | null> {
  const vs = params.vs ?? "usd";
  const search = new URLSearchParams({
    chainId: toBackendChainId(params.chainId),
    address: toBackendAddress(params.address),
    range: params.range,
    vs,
  });
  try {
    return await fetchJson<SimplHistoryResult>(
      `${API_BASE_URL}/v1/prices/history?${search.toString()}`,
    );
  } catch (error) {
    priceWarn("simpl history failed", {
      chainId: params.chainId,
      address: params.address,
      range: params.range,
      error: String(error),
    });
    return null;
  }
}

// GET /v1/prices/ohlc — OHLC candles for one asset over a range. Optional: the
// gateway may not have candles for every asset/range, in which case it returns
// an empty `candles` array (or 404), and the caller falls back to the line
// history from getPriceHistory. Returns null only on a transport/parse error.
export async function getPriceOhlc(params: {
  chainId: number;
  address: string | null;
  range: SimplHistoryRange;
  vs?: VsCurrency;
}): Promise<SimplOhlcResult | null> {
  const vs = params.vs ?? "usd";
  const search = new URLSearchParams({
    chainId: toBackendChainId(params.chainId),
    address: toBackendAddress(params.address),
    range: params.range,
    vs,
  });
  const url = `${API_BASE_URL}/v1/prices/ohlc?${search.toString()}`;
  try {
    const result = await fetchJson<SimplOhlcResult>(url);
    priceDebug("simpl ohlc", {
      url,
      source: result?.source ?? null,
      candles: result?.candles?.length ?? 0,
    });
    return result;
  } catch (error) {
    priceWarn("simpl ohlc failed", {
      chainId: params.chainId,
      address: params.address,
      range: params.range,
      error: String(error),
    });
    return null;
  }
}

// GET /v1/assets/resolve — identity normalization + the gateway's
// includeInTotalBalance verdict for an asset.
export async function resolveAsset(params: {
  chainId: number;
  address: string | null;
}): Promise<SimplAssetResolution | null> {
  // TON native (Gram) is resolved LOCALLY — the gateway has no generic
  // /v1/assets/resolve route for TON (it 404s on chainId=ton&address=native).
  // TON market data routes exclusively through the /v1/ton/* proxy; the native
  // asset is a known mainnet asset that always counts toward total balance.
  // Metadata mirrors ton.tokens TON_NATIVE_TOKEN (GRAM / Gram / 9).
  if (params.chainId === TON_MAINNET_CHAIN_ID && params.address === null) {
    return {
      chainId: "ton",
      address: NATIVE_ADDRESS,
      symbol: "GRAM",
      name: "Gram",
      includeInTotalBalance: true,
    };
  }

  const search = new URLSearchParams({
    chainId: toBackendChainId(params.chainId),
    address: toBackendAddress(params.address),
  });
  try {
    return await fetchJson<SimplAssetResolution>(
      `${API_BASE_URL}/v1/assets/resolve?${search.toString()}`,
    );
  } catch (error) {
    priceWarn("simpl resolve failed", {
      chainId: params.chainId,
      address: params.address,
      error: String(error),
    });
    return null;
  }
}

// GET /v1/assets/metadata — symbol / name / decimals / logo for an asset.
export async function getAssetMetadata(params: {
  chainId: number;
  address: string | null;
}): Promise<SimplAssetMetadata | null> {
  // TON native (Gram) metadata is local — the gateway has no generic asset
  // route for TON native (see resolveAsset). Mirrors ton.tokens TON_NATIVE_TOKEN.
  if (params.chainId === TON_MAINNET_CHAIN_ID && params.address === null) {
    return {
      chainId: "ton",
      address: NATIVE_ADDRESS,
      symbol: "GRAM",
      name: "Gram",
      decimals: 9,
      logoUrl: null,
    };
  }

  const search = new URLSearchParams({
    chainId: toBackendChainId(params.chainId),
    address: toBackendAddress(params.address),
  });
  try {
    return await fetchJson<SimplAssetMetadata>(
      `${API_BASE_URL}/v1/assets/metadata?${search.toString()}`,
    );
  } catch (error) {
    priceWarn("simpl metadata failed", {
      chainId: params.chainId,
      address: params.address,
      error: String(error),
    });
    return null;
  }
}

export const simplMarketApi = {
  baseUrl: API_BASE_URL,
  toBackendChainId,
  getSpotPrice,
  getBatchPrices,
  getPriceHistory,
  getPriceOhlc,
  resolveAsset,
  getAssetMetadata,
};
