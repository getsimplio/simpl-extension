// src/popup/components/SwapHeader.tsx
//
// Shared top bar for every Swap mode (same-chain EVM, cross-chain LI.FI, Solana)
// so the header looks identical: back button on the left, centered title with a
// small subtitle (active network / route mode) below it, and a right slot that
// keeps the title centered (a settings control or an equal-width spacer). It
// mirrors the canonical EVM swap header's `swap-page-title` styling.

import type { ReactNode } from "react";
import { useTranslation } from "../../i18n";

type SwapHeaderProps = {
  title?: string;
  // Small line under the title — e.g. the network name or "Cross-chain route".
  subtitle?: string;
  onBack: () => void;
  // Optional right-side control (e.g. settings). When omitted, an equal-width
  // spacer keeps the title visually centered.
  right?: ReactNode;
};

export function SwapHeader({
  title = "Swap",
  subtitle,
  onBack,
  right,
}: SwapHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="bar-top">
      <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="swap-page-title">
        <div className="swap-page-title__name">{title}</div>
        {subtitle ? (
          <div className="swap-page-title__network">{subtitle}</div>
        ) : null}
      </div>

      {right ?? <span className="swap-header-spacer" aria-hidden="true" />}
    </div>
  );
}
