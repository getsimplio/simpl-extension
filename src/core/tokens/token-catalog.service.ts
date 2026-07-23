// src/core/tokens/token-catalog.service.ts
//
// Client for GET /v1/tokens/catalog — the gateway's UNION token catalog
// (LI.FI + PancakeSwap + Jupiter + the server-side registry), which replaces
// the LI.FI-only proxy as the cross-network token picker's catalog source.
// The gateway merges + dedupes per chain server-side (LI.FI wins field-wise,
// then pancake, then jupiter) — this module only fetches, validates and
// converts rows into the picker's existing BridgeToken shape.
//
// Wire contract (public route, {ok,data} envelope like /v1/config/runtime):
//   GET {API_BASE}/v1/tokens/catalog?chains=<csv of SIMPL numeric chain ids>
//   data.tokens = { "<requested simpl chainId>": TokenRow[] }
//   TokenRow   = { chainId, address, symbol, name, decimals, logoUrl,
//                  isNative, sources }
//
// Chain-id spaces: the WIRE uses SIMPL numeric ids (Solana = 5757000101); the
// PICKER uses LI.FI ids (Solana = LIFI_SOLANA_CHAIN_ID). TRON/EVM ids are
// identical in both spaces. Callers pass picker-space ids (exactly like
// getBridgeTokensForChains) and receive picker-space rows back, so PickerToken
// shapes stay unchanged.
//
// Native conventions are the provider's own (same as the LI.FI catalog today):
// EVM native = 0x000…0 with isNative true; Solana native = the wSOL mint
// (isNative false); TRON native = the T9yD14… base58 sentinel.
//
// Failure behavior: this module THROWS on any network/shape failure — the
// picker catches and falls back to the LI.FI proxy (getBridgeTokensForChains),
// then to the TRON registry seed, so behavior never regresses below today's
// while the union endpoint is not yet deployed.

import {
  LIFI_NATIVE_ADDRESS,
  LIFI_SOLANA_CHAIN_ID,
} from "../bridge/lifi-constants";
import { SOLANA_MAINNET_CHAIN_ID } from "../networks/chain-registry";
import type { BridgeToken } from "../bridge/lifi-bridge.service";

// Resolve the gateway base URL — same precedence as lifi-bridge.service.ts /
// runtime-config.service.ts: explicit Simpl API var → legacy swap-proxy var →
// production gateway. `import.meta.env` is statically replaced by Vite and
// undefined under a plain Node/tsx runtime (the check scripts), so read it
// defensively.
function resolveApiBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const candidate =
    env?.VITE_SIMPL_API_URL ??
    env?.VITE_SIMPL_SWAP_PROXY_URL ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();

// Same request timeout as the LI.FI bridge client.
const FETCH_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Picker (LI.FI) chain-id space → SIMPL wire space (query param). */
function toSimplChainId(pickerChainId: number): number {
  return pickerChainId === LIFI_SOLANA_CHAIN_ID
    ? SOLANA_MAINNET_CHAIN_ID
    : pickerChainId;
}

// A raw union-catalog TokenRow, typed loosely — every field is validated
// before use. `chainId` on the row is in SIMPL space; rows are keyed by the
// REQUESTED chain id, which is authoritative for grouping (mirrors how
// getBridgeTokensForChains trusts the response's chain keys).
type RawCatalogTokenRow = {
  chainId?: number;
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoUrl?: string | null;
  isNative?: boolean;
  sources?: string[];
};

// Convert a raw union row into the picker's existing BridgeToken shape,
// stamped with the PICKER-space chain id. The union catalog carries no price
// (the picker never displays one), so priceUsd is null. isNative prefers the
// server's explicit flag and falls back to the LI.FI zero-address convention.
function normalizeCatalogRow(
  raw: RawCatalogTokenRow,
  pickerChainId: number,
): BridgeToken | null {
  if (
    typeof raw.address !== "string" ||
    raw.address === "" ||
    typeof raw.symbol !== "string" ||
    raw.symbol === ""
  ) {
    return null;
  }
  return {
    chainId: pickerChainId,
    address: raw.address,
    symbol: raw.symbol,
    name: typeof raw.name === "string" && raw.name !== "" ? raw.name : raw.symbol,
    decimals:
      typeof raw.decimals === "number" && Number.isFinite(raw.decimals)
        ? raw.decimals
        : 18,
    logoUrl: typeof raw.logoUrl === "string" && raw.logoUrl !== "" ? raw.logoUrl : null,
    priceUsd: null,
    isNative:
      typeof raw.isNative === "boolean"
        ? raw.isNative
        : raw.address.toLowerCase() === LIFI_NATIVE_ADDRESS.toLowerCase(),
  };
}

/**
 * Fetch the union token catalog for several chains in one round-trip and
 * return the rows flattened, each tagged with its PICKER-space chainId — a
 * drop-in replacement for getBridgeTokensForChains (same input/output space).
 * Production chains only (callers pass mainnet picker ids). Throws on any
 * network or payload-shape failure so callers can run their fallback chain.
 */
export async function getCatalogTokensForChains(
  pickerChainIds: number[],
): Promise<BridgeToken[]> {
  const unique = Array.from(
    new Set(pickerChainIds.filter((id) => Number.isFinite(id))),
  );
  if (unique.length === 0) return [];

  const search = new URLSearchParams({
    chains: unique.map((id) => String(toSimplChainId(id))).join(","),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let raw: unknown;
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/tokens/catalog?${search.toString()}`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    raw = await response.json();
  } finally {
    clearTimeout(timer);
  }

  // Public gateway envelope { ok, data }; tolerate a bare payload (same
  // parsing stance as runtime-config.service.ts).
  let payload: unknown = raw;
  if (isRecord(raw) && "ok" in raw) {
    if (raw.ok !== true) throw new Error("gateway envelope not ok");
    payload = raw.data;
  }
  const tokensByChain =
    isRecord(payload) && isRecord(payload.tokens) ? payload.tokens : null;
  if (!tokensByChain) throw new Error("unusable token catalog payload");

  const out: BridgeToken[] = [];
  for (const pickerId of unique) {
    const rows = tokensByChain[String(toSimplChainId(pickerId))];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const token = normalizeCatalogRow(
        (row ?? {}) as RawCatalogTokenRow,
        pickerId,
      );
      if (token) out.push(token);
    }
  }
  return out;
}
