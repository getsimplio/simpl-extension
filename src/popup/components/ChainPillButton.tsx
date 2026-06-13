// src/popup/components/ChainPillButton.tsx
//
// Compact, rounded chain pill (icon + chain name + chevron) shared by every
// chain selector on the Swap screen — the source pill, the destination picker
// trigger, and the cross-chain panel's From/To pills — so they all look
// identical and sit in the same predictable top-right slot. Presentational
// only: it renders a button and calls onClick.

import { ChainIcon } from "./ChainIcon";

type ChainPillButtonProps = {
  chainId: number;
  name: string;
  // Fallback logo (e.g. a LI.FI chain logo) used only when the wallet has no
  // local network art for this chain.
  logoUrl?: string | null;
  disabled?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
};

export function ChainPillButton({
  chainId,
  name,
  logoUrl,
  disabled,
  onClick,
  ariaLabel,
}: ChainPillButtonProps) {
  return (
    <button
      className="swap-chain-pill"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel ?? `Chain: ${name}`}
    >
      <ChainIcon chainId={chainId} name={name} logoUrl={logoUrl} size={18} />
      <span className="swap-chain-pill__name">{name}</span>
      <span className="swap-token-pill__chevron">▾</span>
    </button>
  );
}
