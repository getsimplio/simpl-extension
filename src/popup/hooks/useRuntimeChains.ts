// src/popup/hooks/useRuntimeChains.ts
//
// React binding for the server-driven network list. Subscribes to the runtime
// config via useSyncExternalStore (same store idiom as i18n) so the network
// selector re-renders the moment the config resolves or refreshes, then
// projects it onto the local registry with resolveVisibleChains.
//
// The config resolves lazily: the popup/sidepanel entrypoints already fire
// refreshRuntimeConfig() at boot, but this hook also kicks a resolve on mount
// so a screen that renders before that (or in isolation) still converges —
// getRuntimeConfig() is memoized/deduped, so the extra call is free.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { SimplRuntimeConfig } from "@getsimpl/config";
import {
  getCachedRuntimeConfigSnapshot,
  getRuntimeConfig,
  subscribeRuntimeConfig,
} from "../../core/config/runtime-config.service";
import { resolveVisibleChains } from "../../core/networks/chain-visibility";
import type { ChainConfig } from "../../core/networks/chain-registry";

function useRuntimeConfigSnapshot(): SimplRuntimeConfig | null {
  useEffect(() => {
    // Ensure a resolve is in flight; harmless if one already ran.
    void getRuntimeConfig();
  }, []);
  return useSyncExternalStore(
    subscribeRuntimeConfig,
    getCachedRuntimeConfigSnapshot,
    getCachedRuntimeConfigSnapshot,
  );
}

/**
 * The ordered networks the selector should show, reactive to runtime config.
 * Before the config resolves (snapshot null) this returns the full local
 * registry, so the selector is never empty and matches today's behavior.
 */
export function useRuntimeChains(selectedChainId?: number): ChainConfig[] {
  const config = useRuntimeConfigSnapshot();
  return useMemo(
    () => resolveVisibleChains(config, selectedChainId),
    [config, selectedChainId],
  );
}
