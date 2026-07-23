// src/popup/hooks/useSwapAssetAllowlist.ts
//
// React binding for the server-driven trade-asset allowlists (Stage 3 of the
// runtime-config rollout). Same store idiom as useRuntimeChains: subscribes to
// the runtime config via useSyncExternalStore, so trade token lists narrow the
// moment a published server config resolves — and stay untouched (allowlist
// === null) offline, on the embedded fallback, or on the API's static seed.

import { useMemo } from "react";
import {
  buildTradeAllowlist,
  type SwapAssetAllowlist,
  type TradeFeature,
} from "../../core/config/swap-asset-availability";
import { useRuntimeConfigSnapshot } from "./useRuntimeChains";

export function useTradeAllowlist(feature: TradeFeature): SwapAssetAllowlist {
  const config = useRuntimeConfigSnapshot();
  return useMemo(() => buildTradeAllowlist(config, feature), [config, feature]);
}

/** The swap-toggle allowlist (`assets[].features.swap`). */
export function useSwapAssetAllowlist(): SwapAssetAllowlist {
  return useTradeAllowlist("swap");
}

/** The bridge-toggle allowlist (`assets[].features.bridge`). */
export function useBridgeAssetAllowlist(): SwapAssetAllowlist {
  return useTradeAllowlist("bridge");
}
