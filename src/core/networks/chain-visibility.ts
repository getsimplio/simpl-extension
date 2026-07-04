// src/core/networks/chain-visibility.ts
//
// Stage 2 of the runtime-config rollout: which networks the selector shows and
// in what order is server-driven — but STRICTLY as a projection over the
// compile-time DEFAULT_CHAINS registry. The runtime config can hide, show and
// reorder chains the wallet already ships; it can NEVER introduce a new chain.
//
// Why the hard constraint: MV3 host_permissions are static (see
// core/network/endpoint-inventory.ts + check:manifest). A chain delivered by
// config with an RPC host outside the shipped allow-list could not be reached
// for balances/sends anyway. So we always resolve to the LOCAL ChainConfig
// (with its bundled rpcUrl) and only consult config for enabled/visibility/
// ordering — config-supplied rpcUrls are intentionally ignored here.
//
// Safety rails:
//   • config unavailable, or an embedded-fallback config (meta.source ===
//     "fallback") → return the full local registry unchanged (today's
//     behavior, verbatim);
//   • a server-sourced config (db/seed) filters mainnets to the enabled +
//     visibleByDefault chains it lists, ordered by the config order (already
//     priority-sorted by the resolver);
//   • testnets are NEVER config-driven — they come straight from the local
//     registry (the extension requests config without allowTestnet, so the
//     server never lists them);
//   • the currently-SELECTED chain is always kept visible, so an admin change
//     can never strand a user on a network that has vanished from the list.

import type { SimplRuntimeConfig } from "@getsimpl/config";
import { DEFAULT_CHAINS, type ChainConfig } from "./chain-registry";

/**
 * The ordered list of networks the selector should show for the given config.
 *
 * @param config          resolved runtime config (or null before first resolve)
 * @param selectedChainId the active chain — always kept visible
 * @param allChains       local registry (injectable for tests; defaults to DEFAULT_CHAINS)
 */
export function resolveVisibleChains(
  config: SimplRuntimeConfig | null | undefined,
  selectedChainId?: number,
  allChains: readonly ChainConfig[] = DEFAULT_CHAINS,
): ChainConfig[] {
  // No server opinion → behave exactly like the pre-config wallet.
  if (!config || config.meta.source === "fallback") {
    return [...allChains];
  }

  const localMainnets = allChains.filter((c) => !c.isTestnet);
  const localTestnets = allChains.filter((c) => c.isTestnet);
  const localByChainId = new Map(allChains.map((c) => [c.chainId, c]));

  // config.chains are already enabled-only + priority-sorted by the resolver;
  // re-check defensively and honor visibleByDefault.
  const visibleMainnets: ChainConfig[] = [];
  const included = new Set<number>();
  for (const cc of config.chains) {
    if (cc.enabled === false || cc.visibleByDefault === false) continue;
    const local = localByChainId.get(cc.chainId);
    if (!local || local.isTestnet) continue; // must exist locally; testnets handled below
    if (included.has(local.chainId)) continue;
    included.add(local.chainId);
    visibleMainnets.push(local);
  }

  // Safety: never drop the active chain from the list. If config hid it (or the
  // config simply doesn't know it), re-insert it in its natural registry order.
  if (
    selectedChainId != null &&
    !included.has(selectedChainId) &&
    localByChainId.has(selectedChainId)
  ) {
    const selected = localByChainId.get(selectedChainId) as ChainConfig;
    if (!selected.isTestnet) {
      const registryIndex = localMainnets.findIndex((c) => c.chainId === selectedChainId);
      // Insert at the position that best preserves registry order among the
      // already-included mainnets; fall back to append.
      let insertAt = visibleMainnets.length;
      for (let i = 0; i < visibleMainnets.length; i++) {
        const idx = localMainnets.findIndex((c) => c.chainId === visibleMainnets[i].chainId);
        if (idx > registryIndex) {
          insertAt = i;
          break;
        }
      }
      visibleMainnets.splice(insertAt, 0, selected);
      included.add(selectedChainId);
    }
  }

  // If a server config somehow yielded no visible mainnets, fall back to the
  // full local registry rather than render an empty selector.
  if (visibleMainnets.length === 0) {
    return [...allChains];
  }

  return [...visibleMainnets, ...localTestnets];
}
