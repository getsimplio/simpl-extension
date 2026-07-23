// src/core/config/swap-asset-availability.ts
//
// Stage 3 of the runtime-config rollout: which assets the SWAP / BRIDGE flows
// offer is server-driven — the admin catalog's per-asset "Swap enabled" /
// "Bridge enabled" toggles arrive as `assets[].features.swap` / `.bridge` in
// the runtime config. Like the Stage 2 chain projection
// (core/networks/chain-visibility.ts) this is STRICTLY a filter over
// candidates the wallet already discovered locally (portfolio, registered
// tokens, imported tokens, the LI.FI catalog): config can only NARROW the
// trade token lists, never add a token, an address, or a host.
//
// Safety rails:
//   • only a PUBLISHED server config gates (meta.source === "db"). The
//     embedded fallback ("fallback") and the API's static seed ("seed", served
//     during a gateway DB outage) leave every list untouched — matching the
//     dashboard's swap-availability semantics, so a backend incident can never
//     narrow the wallet;
//   • testnet chains are NEVER config-driven (the extension requests config
//     without allowTestnet, so the server cannot even express them) → testnet
//     candidates are always allowed;
//   • otherwise allowlist semantics, matching the dashboard: an asset is
//     tradable iff the config lists a matching entry with `enabled !== false
//     && features[feature] === true`. A db config in which the admin enabled
//     NOTHING therefore empties the lists (fail-closed, dashboard parity) —
//     the product-level kill switch remains the `swaps`/`bridge` feature flag.
//     Matching is by (chainId, address): hex addresses compare
//     case-insensitively, base58 (Solana/TRON) compares exactly; native assets
//     match the config entry with `address: null` — never by symbol, so a
//     same-symbol impostor token can not ride an allowed listing. The LI.FI
//     catalog reports native SOL as the wSOL mint and native TRX as LI.FI's
//     base58 sentinel (both with isNative=false) — those sentinel addresses
//     are recognized as the chain's native asset here.

import { isFeatureEnabled, type SimplRuntimeConfig } from "@getsimpl/config";
import { DEFAULT_CHAINS, SOLANA_MAINNET_CHAIN_ID, TRON_MAINNET_CHAIN_ID } from "../networks/chain-registry";
import {
  LIFI_SOLANA_CHAIN_ID,
  LIFI_SOLANA_NATIVE_MINT,
  LIFI_TRON_NATIVE_ADDRESS,
} from "../bridge/lifi-constants";

/** Per-asset admin toggles this projection understands. */
export type TradeFeature = "swap" | "bridge";

/**
 * Admin mode switch (feature flag, editable in the dashboard's Config →
 * Features tab): ON / missing → curated mode, only catalog-enabled assets are
 * offered (the behavior below); OFF → the wallet offers the FULL live provider
 * catalogs (LI.FI etc.) for swap and bridge — curated config assets still seed
 * the pickers, so admin additions unknown to providers remain available.
 */
export const ASSET_GATING_FLAG = "asset-gating";

/** A trade candidate from any local source (portfolio, registry, LI.FI catalog). */
export type SwapAssetCandidate = {
  /** Extension registry chain id OR a LI.FI chain id (normalized internally). */
  chainId: number;
  /** On-chain address / mint / contract; ignored when isNative. */
  address: string | null | undefined;
  isNative: boolean;
};

type ChainAllowlist = {
  native: boolean;
  /** Normalized token addresses (hex lowercased, base58 verbatim). */
  addresses: Set<string>;
};

/** null → no gating (fail open, today's behavior). */
export type SwapAssetAllowlist = Map<number, ChainAllowlist> | null;

const TESTNET_CHAIN_IDS = new Set(
  DEFAULT_CHAINS.filter((c) => c.isTestnet).map((c) => c.chainId),
);

/**
 * The pickers speak LI.FI chain ids for non-EVM networks; the config speaks the
 * shared registry sentinels. EVM ids and the TRON id coincide; only Solana
 * differs.
 */
export function toConfigChainId(chainId: number): number {
  return chainId === LIFI_SOLANA_CHAIN_ID ? SOLANA_MAINNET_CHAIN_ID : chainId;
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  return trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.toLowerCase()
    : trimmed;
}

/**
 * Build the per-chain allowlist for a trade feature from a resolved runtime
 * config. Pure (unit-tested by scripts/check-runtime-config.ts).
 */
export function buildTradeAllowlist(
  config: SimplRuntimeConfig | null | undefined,
  feature: TradeFeature,
): SwapAssetAllowlist {
  // Only a published server config gates; fallback/seed → today's behavior.
  if (!config || config.meta.source !== "db") return null;

  // Admin turned curation off → full provider catalogs, no per-asset gating.
  if (!isFeatureEnabled(config, ASSET_GATING_FLAG, true)) return null;

  const byChain = new Map<number, ChainAllowlist>();

  for (const asset of config.assets) {
    if (asset.enabled === false) continue;
    if (asset.features?.[feature] !== true) continue;
    if (typeof asset.chainId !== "number") continue;

    let entry = byChain.get(asset.chainId);
    if (!entry) {
      entry = { native: false, addresses: new Set() };
      byChain.set(asset.chainId, entry);
    }
    if (asset.address == null || asset.isNative) {
      entry.native = true;
    } else {
      entry.addresses.add(normalizeAddress(asset.address));
    }
  }

  return byChain;
}

/** The swap-toggle allowlist (`assets[].features.swap`). */
export function buildSwapAllowlist(
  config: SimplRuntimeConfig | null | undefined,
): SwapAssetAllowlist {
  return buildTradeAllowlist(config, "swap");
}

/** The bridge-toggle allowlist (`assets[].features.bridge`). */
export function buildBridgeAllowlist(
  config: SimplRuntimeConfig | null | undefined,
): SwapAssetAllowlist {
  return buildTradeAllowlist(config, "bridge");
}

/** Whether the candidate may appear in trade token lists under this allowlist. */
export function isSwapAssetAllowed(
  allowlist: SwapAssetAllowlist,
  candidate: SwapAssetCandidate,
): boolean {
  if (!allowlist) return true;

  const chainId = toConfigChainId(candidate.chainId);
  // Testnets are never config-driven — leave them untouched.
  if (TESTNET_CHAIN_IDS.has(chainId)) return true;

  const entry = allowlist.get(chainId);
  if (!entry) return false;
  if (candidate.isNative) return entry.native;
  if (candidate.address == null || candidate.address === "") return false;

  const normalized = normalizeAddress(candidate.address);
  // LI.FI catalog rows for native SOL / TRX carry sentinel ADDRESSES with
  // isNative=false — recognize them as the chain's native asset (an explicit
  // address listing still works via the address set).
  const isNativeSentinel =
    (chainId === SOLANA_MAINNET_CHAIN_ID && normalized === LIFI_SOLANA_NATIVE_MINT) ||
    (chainId === TRON_MAINNET_CHAIN_ID && normalized === LIFI_TRON_NATIVE_ADDRESS);
  if (isNativeSentinel && entry.native) return true;

  return entry.addresses.has(normalized);
}
