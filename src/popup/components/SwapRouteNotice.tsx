// src/popup/components/SwapRouteNotice.tsx
//
// Shared compact route notice used across all Swap modes (same-chain Solana
// hint, cross-chain LI.FI hint, preview-only state). It replaces the old, large
// green Solana notice and the ad-hoc bridge hint with one calm, secondary style
// that never dominates the screen.
//
//  • "hint"    — muted, secondary helper copy (default)
//  • "preview" — the quote-found-but-not-executable callout

import type { ReactNode } from "react";

type SwapRouteNoticeProps = {
  children: ReactNode;
  variant?: "hint" | "preview";
};

export function SwapRouteNotice({
  children,
  variant = "hint",
}: SwapRouteNoticeProps) {
  return (
    <div className={variant === "preview" ? "swap-preview-note" : "swap-cross-helper"}>
      {children}
    </div>
  );
}
