// src/popup/components/ChainIcon.tsx
//
// One rendering path for every chain icon on the Swap screen (chain pills and
// chain-picker rows). It prefers the wallet's own network art so a chain looks
// identical everywhere — same-chain or cross-chain — and only falls back to a
// provided (e.g. LI.FI) logo for chains the wallet has no local art for, then to
// a uniform letter badge. This keeps BNB Chain / Base / Solana / Ethereum icons
// visually consistent regardless of where they're shown.

import { getNetworkIconUrl } from "./NetworkIcon";

type ChainIconProps = {
  chainId: number;
  name: string;
  // Optional fallback logo (e.g. a LI.FI chain logo) used only when the wallet
  // has no local network icon for this chain.
  logoUrl?: string | null;
  size?: number;
};

export function ChainIcon({ chainId, name, logoUrl, size = 18 }: ChainIconProps) {
  const src = getNetworkIconUrl(chainId, name) ?? logoUrl ?? null;
  const dimension = { width: size, height: size };

  if (src) {
    return (
      <img
        className="swap-chain-icon"
        src={src}
        alt=""
        style={dimension}
      />
    );
  }

  return (
    <span className="swap-chain-icon swap-chain-icon--fallback" style={dimension}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
