// src/popup/components/SwapRouteNotice.tsx
//
// Shared compact route notice used across all Swap modes (same-chain Solana
// hint, cross-chain LI.FI hint, preview-only state). It replaces the old, large
// green Solana notice and the ad-hoc bridge hint with one calm, secondary style
// that never dominates the screen.
//
//  • "hint"    — muted, secondary helper copy (default)
//  • "preview" — the quote-found-but-not-executable callout
//  • "warning" — a calm amber caution (e.g. high fees on a small route)

import type { ReactNode } from "react";

type SwapRouteNoticeProps = {
  children: ReactNode;
  variant?: "hint" | "preview" | "warning";
};

const VARIANT_CLASS: Record<NonNullable<SwapRouteNoticeProps["variant"]>, string> = {
  hint: "swap-cross-helper",
  preview: "swap-preview-note",
  warning: "swap-warning-note",
};

export function SwapRouteNotice({
  children,
  variant = "hint",
}: SwapRouteNoticeProps) {
  return <div className={VARIANT_CLASS[variant]}>{children}</div>;
}
