// src/popup/components/TokenWithChainBadge.tsx
//
// The token is the primary object; the network is a small contextual badge in
// the bottom-right corner of the token icon — not a second large pill. Used by
// every Swap mode (EVM swap, cross-chain bridge, Solana swap) so the token +
// chain control looks identical everywhere.

import { AssetIcon } from "./AssetIcon";
import { ChainIcon } from "./ChainIcon";

type TokenWithChainBadgeProps = {
  symbol?: string | null;
  tokenLogoUrl?: string | null;
  // null/undefined address → native token art.
  tokenAddress?: string | null;
  // Chain the token lives on — drives both the token-icon CDN lookup and the
  // small corner badge.
  chainId: number;
  chainName: string;
  chainLogoUrl?: string | null;
  size?: number;
};

export function TokenWithChainBadge({
  symbol,
  tokenLogoUrl,
  tokenAddress,
  chainId,
  chainName,
  chainLogoUrl,
  size = 30,
}: TokenWithChainBadgeProps) {
  // Badge is ~40% of the token icon, clamped to a readable minimum.
  const badgeSize = Math.max(12, Math.round(size * 0.42));
  return (
    <span
      className="token-chain-badge"
      style={{ width: size, height: size }}
      title={chainName}
    >
      <AssetIcon
        ticker={symbol}
        logoURI={tokenLogoUrl}
        address={tokenAddress ?? null}
        chainId={chainId}
        size={size}
        className="token-chain-badge__token"
      />
      <span className="token-chain-badge__chain" aria-hidden="true">
        <ChainIcon
          chainId={chainId}
          name={chainName}
          logoUrl={chainLogoUrl}
          size={badgeSize}
        />
      </span>
    </span>
  );
}
