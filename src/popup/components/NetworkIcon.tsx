// src/popup/components/NetworkIcon.tsx

type NetworkIconProps = {
  chainId?: number | string | null;
  networkName?: string | null;
  ticker?: string | null;
  size?: number;
  className?: string;
  showTestnetBadge?: boolean;
};

const CHAIN_ID_TO_NAME: Record<number, string> = {
  1: "ethereum",
  56: "bnb",
  8453: "base",
  11155111: "sepolia",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
  43114: "avalanche",
};

// Sepolia reuses the Ethereum icon; the badge distinguishes it visually.
const ICON_FILE: Record<string, string> = {
  ethereum: "/network-icons/ethereum.svg",
  bnb: "/network-icons/bnb.svg",
  base: "/network-icons/base.svg",
  sepolia: "/network-icons/sepolia.svg",
  polygon: "/network-icons/polygon.svg",
  arbitrum: "/network-icons/arbitrum.svg",
  optimism: "/network-icons/optimism.svg",
  avalanche: "/network-icons/avalanche.svg",
};

const FALLBACK_COLORS: Record<string, string> = {
  ethereum: "#627EEA",
  bnb: "#F0B90B",
  base: "#0052FF",
  sepolia: "#627EEA",
  polygon: "#8247E5",
  arbitrum: "#213147",
  optimism: "#FF0420",
  avalanche: "#E84142",
};

const TESTNET_NAMES = new Set(["sepolia"]);

function resolveNetworkName(
  chainId?: number | string | null,
  networkName?: string | null,
  ticker?: string | null,
): string | null {
  if (chainId != null) {
    const n = typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
    if (Number.isFinite(n) && n in CHAIN_ID_TO_NAME) {
      return CHAIN_ID_TO_NAME[n];
    }
  }

  const raw = (networkName ?? ticker ?? "").toLowerCase().trim();
  if (!raw) return null;

  if (raw.includes("sepolia")) return "sepolia";
  if (raw.includes("ethereum") || raw === "eth" || raw.includes("mainnet")) return "ethereum";
  if (raw === "bnb" || raw === "bsc" || raw.includes("smart chain")) return "bnb";
  if (raw === "base") return "base";
  if (raw.includes("polygon") || raw === "matic" || raw === "pol") return "polygon";
  if (raw.includes("arbitrum") || raw === "arb") return "arbitrum";
  if (raw.includes("optimism") || raw === "op") return "optimism";
  if (raw.includes("avalanche") || raw === "avax") return "avalanche";

  return null;
}

export function NetworkIcon({
  chainId,
  networkName,
  ticker,
  size = 28,
  className,
  showTestnetBadge,
}: NetworkIconProps) {
  const name = resolveNetworkName(chainId, networkName, ticker);
  const iconSrc = name ? ICON_FILE[name] : null;
  const isTestnet = name != null && TESTNET_NAMES.has(name);
  const badge = showTestnetBadge !== false && isTestnet;

  const label =
    (networkName ?? ticker ?? "?").slice(0, 1).toUpperCase() || "?";
  const fallbackBg =
    name ? (FALLBACK_COLORS[name] ?? "#E2E8F0") : "#E2E8F0";

  return (
    <span
      className={`network-icon${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {iconSrc ? (
        <img
          src={iconSrc}
          alt={name ?? ""}
          width={size}
          height={size}
          className="network-icon__img"
        />
      ) : (
        <svg
          width={size}
          height={size}
          viewBox="0 0 28 28"
          className="network-icon--fallback"
        >
          <circle cx="14" cy="14" r="14" fill={fallbackBg} />
          <text
            x="14"
            y="14"
            dominantBaseline="central"
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fontFamily="system-ui,-apple-system,sans-serif"
            fill="white"
          >
            {label}
          </text>
        </svg>
      )}
      {badge && <span className="network-icon__testnet-badge" />}
    </span>
  );
}
