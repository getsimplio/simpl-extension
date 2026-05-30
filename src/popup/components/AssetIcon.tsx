// src/popup/components/AssetIcon.tsx

import { useState } from "react";
import { getAddress } from "ethers";

type AssetIconProps = {
  ticker?: string | null;
  symbol?: string | null;
  logoURI?: string | null;
  address?: string | null;
  chainId?: number;
  size?: number;
  className?: string;
};

const TOKEN_ICONS: Record<string, string> = {
  BNB: "/token-icons/bnb.png",
  WBNB: "/token-icons/bnb.png",
  USDT: "/token-icons/usdt.png",
  USDC: "/token-icons/usdc.png",
  CAKE: "/token-icons/cake.png",
  ETH: "/token-icons/eth.png",
  WETH: "/token-icons/eth.png",
  BTC: "/token-icons/btc.png",
  WBTC: "/token-icons/btc.png",
  SOL: "/token-icons/sol.png",
  MATIC: "/token-icons/matic.png",
  POL: "/token-icons/matic.png",
};

const TRUST_WALLET_CHAIN_SLUGS: Record<number, string> = {
  1: "ethereum",
  56: "smartchain",
  8453: "base",
};

const FALLBACK_PALETTE = [
  { bg: "#E8F0FE", fg: "#2B63D9" },
  { bg: "#FEF0E8", fg: "#D96B2B" },
  { bg: "#E8FEF0", fg: "#1DA85A" },
  { bg: "#F8E8FE", fg: "#A32BD9" },
  { bg: "#F0E8FE", fg: "#6A2BD9" },
  { bg: "#E8F8FE", fg: "#2BB5D9" },
  { bg: "#FEF8E8", fg: "#C49B00" },
  { bg: "#E8FEFC", fg: "#2BD9C4" },
];

// Module-level cache of URLs that failed to load — persists across component instances
const failedUrls = new Set<string>();

function resolveTokenLogoUrl(
  address: string | null | undefined,
  chainId: number | undefined,
): string | null {
  if (!address || !chainId) return null;
  const slug = TRUST_WALLET_CHAIN_SLUGS[chainId];
  if (!slug) return null;
  try {
    const checksumAddr = getAddress(address);
    return `https://assets.trustwallet.com/blockchains/${slug}/assets/${checksumAddr}/logo.png`;
  } catch {
    return null;
  }
}

function hashTicker(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h;
}

export function AssetIcon({
  ticker,
  symbol,
  logoURI,
  address,
  chainId,
  size = 32,
  className,
}: AssetIconProps) {
  const key = (ticker ?? symbol ?? "").toUpperCase();
  const [, setFailTick] = useState(0);

  // Build ordered priority list of image URLs to try
  const sources: string[] = [];
  const hardcoded = TOKEN_ICONS[key];
  if (hardcoded) sources.push(hardcoded);
  if (logoURI && logoURI.startsWith("https://")) sources.push(logoURI);
  const external = resolveTokenLogoUrl(address, chainId);
  if (external && !sources.includes(external)) sources.push(external);

  // First source not known to have failed
  const activeSrc = sources.find((src) => !failedUrls.has(src)) ?? null;

  if (activeSrc) {
    return (
      <img
        src={activeSrc}
        alt={key || "token"}
        width={size}
        height={size}
        className={`asset-icon asset-icon-image${className ? ` ${className}` : ""}`}
        style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}
        onError={() => {
          failedUrls.add(activeSrc);
          setFailTick((n) => n + 1);
        }}
      />
    );
  }

  // Fallback avatar — first letter with pastel background
  const label = key.slice(0, 1) || "?";
  const palette =
    FALLBACK_PALETTE[hashTicker(key || "?") % FALLBACK_PALETTE.length];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      className={`asset-icon asset-icon-fallback${className ? ` ${className}` : ""}`}
      style={{ flexShrink: 0 }}
    >
      <circle cx="22" cy="22" r="22" fill={palette.bg} />
      <text
        x="22"
        y="22"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="17"
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={palette.fg}
      >
        {label}
      </text>
    </svg>
  );
}
