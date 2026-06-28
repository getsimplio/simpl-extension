// src/core/prices/price-identity.ts
//
// Single source of truth for resolving a *stable price identity* for any
// wallet asset, used by every price/history service so spot prices, portfolio
// value and charts all agree. Identity is NEVER symbol-based — symbols collide
// across chains (ETH/USDT/USDC exist on many networks). It is:
//
//   native  → `${chainId}:native`
//   ERC-20  → `${chainId}:${lowercaseContractAddress}`
//
// Known assets map to a CoinGecko coin id (for native + pegged/wrapped tokens
// where a contract lookup would miss or be ambiguous) and declare whether a
// price chart is worth showing (`canHaveChart`). Stablecoins resolve a spot
// price but skip the chart — a flat $1 line is noise.

import {
  BASE_CHAIN_ID,
  BNB_SMART_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  BITCOIN_MAINNET_CHAIN_ID,
  BITCOIN_TESTNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  TRON_MAINNET_CHAIN_ID,
  TON_MAINNET_CHAIN_ID,
} from "../networks/chain-registry";

// Marker used in place of a contract address for a chain's native asset.
export const NATIVE_ADDRESS = "native";

export type KnownPriceAsset = {
  symbol: string;
  // CoinGecko coin id used for native assets and as the spot fallback / chart
  // source for pegged & wrapped tokens.
  coinGeckoId: string;
  // Whether a price chart is meaningful for this asset.
  canHaveChart: boolean;
  // Stablecoins: spot resolves to ~$1 and the chart is intentionally hidden.
  isStable?: boolean;
};

const isDev = Boolean(import.meta.env?.DEV);

// Normalize an asset to its stable price identity key.
export function getPriceIdentityKey(
  chainId: number,
  address: string | null,
): string {
  const addr = address ? address.toLowerCase() : NATIVE_ADDRESS;
  return `${chainId}:${addr}`;
}

// CoinGecko "asset platform" slug for contract-address lookups. Testnets have
// no market data.
export function getCoinGeckoPlatform(chainId: number): string | null {
  if (chainId === ETHEREUM_MAINNET_CHAIN_ID) return "ethereum";
  if (chainId === BNB_SMART_CHAIN_ID) return "binance-smart-chain";
  if (chainId === BASE_CHAIN_ID) return "base";
  return null;
}

// CoinGecko market id for the non-EVM native assets (Bitcoin / Solana), or null
// for any other chain. Both the testnet (BTC Testnet, Solana Devnet) and the
// mainnet map to the SAME mainnet market id — testnets have no market of their
// own, so they borrow the mainnet price/chart purely as a *reference*. Whether
// that reference may count as real portfolio value is decided separately by
// isReferencePriceChain().
export function getNativeAssetMarketId(
  chainId: number,
): "bitcoin" | "solana" | null {
  if (
    chainId === BITCOIN_MAINNET_CHAIN_ID ||
    chainId === BITCOIN_TESTNET_CHAIN_ID
  ) {
    return "bitcoin";
  }
  if (
    chainId === SOLANA_MAINNET_CHAIN_ID ||
    chainId === SOLANA_DEVNET_CHAIN_ID
  ) {
    return "solana";
  }
  return null;
}

// True for chains whose native asset only has a *reference* price: a testnet /
// devnet that borrows a mainnet coin's market data for display, but whose
// balance must NEVER count as real portfolio value. (Bitcoin Testnet, Solana
// Devnet.) Used purely for the "Reference price" UI labelling — total-balance
// inclusion is decided by countsTowardTotalBalance() below.
export function isReferencePriceChain(chainId: number): boolean {
  return (
    chainId === BITCOIN_TESTNET_CHAIN_ID || chainId === SOLANA_DEVNET_CHAIN_ID
  );
}

// Local allowlist safeguard for total-balance inclusion. ONLY mainnets with
// real market value count toward the portfolio total; every testnet/devnet is
// excluded. This mirrors the Simpl API resolver's `includeInTotalBalance`
// verdict and is the authoritative client-side guard: it works offline and
// never relies on UI labels. The gateway's resolve response can only further
// *exclude* an asset (defence in depth), never include one this rejects.
//
//   include → Ethereum (1), BSC (56), Base (8453), Bitcoin, Solana
//   exclude → Sepolia (11155111), Bitcoin Testnet, Solana Devnet
const TOTAL_BALANCE_MAINNET_CHAIN_IDS = new Set<number>([
  ETHEREUM_MAINNET_CHAIN_ID,
  BNB_SMART_CHAIN_ID,
  BASE_CHAIN_ID,
  BITCOIN_MAINNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  TRON_MAINNET_CHAIN_ID,
  TON_MAINNET_CHAIN_ID,
]);

export function countsTowardTotalBalance(chainId: number): boolean {
  return TOTAL_BALANCE_MAINNET_CHAIN_IDS.has(chainId);
}

// CoinGecko coin id for a chain's native asset. Sepolia is mapped to ethereum
// to stay consistent with the native spot price service. Bitcoin and Solana
// (mainnet + testnet/devnet) resolve to their mainnet market id.
export function getNativeCoinId(chainId: number): string | null {
  if (
    chainId === ETHEREUM_MAINNET_CHAIN_ID ||
    chainId === BASE_CHAIN_ID ||
    chainId === SEPOLIA_CHAIN_ID
  ) {
    return "ethereum";
  }
  if (chainId === BNB_SMART_CHAIN_ID) return "binancecoin";
  if (chainId === TRON_MAINNET_CHAIN_ID) return "tron";
  if (chainId === TON_MAINNET_CHAIN_ID) return "the-open-network";
  return getNativeAssetMarketId(chainId);
}

// Known assets keyed by stable price identity. Addresses are lowercase; native
// assets use the NATIVE_ADDRESS marker. Token contract addresses mirror the
// app token registry (src/core/tokens/token-registry.ts).
export const KNOWN_PRICE_ASSETS: Record<string, KnownPriceAsset> = {
  // ---- Native assets ----
  "1:native": { symbol: "ETH", coinGeckoId: "ethereum", canHaveChart: true },
  "56:native": { symbol: "BNB", coinGeckoId: "binancecoin", canHaveChart: true },
  "8453:native": { symbol: "ETH", coinGeckoId: "ethereum", canHaveChart: true },
  "11155111:native": {
    symbol: "ETH",
    coinGeckoId: "ethereum",
    canHaveChart: true,
  },
  "728126428:native": {
    symbol: "TRX",
    coinGeckoId: "tron",
    canHaveChart: true,
  },
  [`${TON_MAINNET_CHAIN_ID}:native`]: {
    symbol: "TON",
    coinGeckoId: "the-open-network",
    canHaveChart: true,
  },

  // ---- Ethereum Mainnet (ERC-20) ----
  "1:0xdac17f958d2ee523a2206206994597c13d831ec7": {
    symbol: "USDT",
    coinGeckoId: "tether",
    canHaveChart: false,
    isStable: true,
  },
  "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    symbol: "USDC",
    coinGeckoId: "usd-coin",
    canHaveChart: false,
    isStable: true,
  },
  "1:0x6b175474e89094c44da98b954eedeac495271d0f": {
    symbol: "DAI",
    coinGeckoId: "dai",
    canHaveChart: false,
    isStable: true,
  },
  "1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    symbol: "WETH",
    coinGeckoId: "weth",
    canHaveChart: true,
  },
  "1:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
    symbol: "WBTC",
    coinGeckoId: "wrapped-bitcoin",
    canHaveChart: true,
  },
  "1:0x514910771af9ca656af840dff83e8264ecf986ca": {
    symbol: "LINK",
    coinGeckoId: "chainlink",
    canHaveChart: true,
  },
  "1:0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    symbol: "UNI",
    coinGeckoId: "uniswap",
    canHaveChart: true,
  },
  "1:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
    symbol: "AAVE",
    coinGeckoId: "aave",
    canHaveChart: true,
  },

  // ---- BNB Smart Chain (BEP-20) ----
  "56:0x55d398326f99059ff775485246999027b3197955": {
    symbol: "USDT",
    coinGeckoId: "tether",
    canHaveChart: false,
    isStable: true,
  },
  "56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
    symbol: "USDC",
    coinGeckoId: "usd-coin",
    canHaveChart: false,
    isStable: true,
  },
  "56:0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3": {
    symbol: "DAI",
    coinGeckoId: "dai",
    canHaveChart: false,
    isStable: true,
  },
  "56:0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": {
    symbol: "WBNB",
    coinGeckoId: "binancecoin",
    canHaveChart: true,
  },
  "56:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82": {
    symbol: "CAKE",
    coinGeckoId: "pancakeswap-token",
    canHaveChart: true,
  },
  "56:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": {
    symbol: "BTCB",
    coinGeckoId: "bitcoin",
    canHaveChart: true,
  },
  "56:0x2170ed0880ac9a755fd29b2688956bd959f933f8": {
    symbol: "ETH",
    coinGeckoId: "ethereum", // Binance-Peg Ethereum
    canHaveChart: true,
  },

  // ---- Base ----
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
    symbol: "USDC",
    coinGeckoId: "usd-coin",
    canHaveChart: false,
    isStable: true,
  },
  "8453:0x4d13a9b2a5ada3b52f36e4ccdb91023f3d05ec6e": {
    symbol: "USDT",
    coinGeckoId: "tether",
    canHaveChart: false,
    isStable: true,
  },
  "8453:0x4200000000000000000000000000000000000006": {
    symbol: "WETH",
    coinGeckoId: "weth",
    canHaveChart: true,
  },
};

// Look up a known asset by stable identity, or null for unknown tokens.
export function getKnownPriceAsset(
  chainId: number,
  address: string | null,
): KnownPriceAsset | null {
  return KNOWN_PRICE_ASSETS[getPriceIdentityKey(chainId, address)] ?? null;
}

// Whether we have any expectation of resolving a spot price for this asset.
// Used to decide between a "Loading…" state and a definitive "No price".
// Unknown tokens still *try* via the contract endpoint, but we don't promise
// a price (so they fall straight through to "No price" rather than spinning).
export function isKnownPriceAsset(
  chainId: number,
  address: string | null,
): boolean {
  if (!address) return getNativeCoinId(chainId) !== null;
  return getKnownPriceAsset(chainId, address) !== null;
}

// CoinGecko coin id for an asset, when one is known. Native + pegged/wrapped
// tokens resolve here; plain ERC-20s return null (priced by contract address).
export function resolveCoinGeckoId(
  chainId: number,
  address: string | null,
): string | null {
  if (!address) return getNativeCoinId(chainId);
  return getKnownPriceAsset(chainId, address)?.coinGeckoId ?? null;
}

// Whether a price chart should be attempted for this asset.
//   native            → yes when a coin id exists
//   known chartable   → yes
//   known stable      → no (flat $1 line is noise)
//   unknown ERC-20    → attempt only when the chain has a CoinGecko platform
export function canResolveChart(
  chainId: number,
  address: string | null,
): boolean {
  if (!address) return getNativeCoinId(chainId) !== null;
  const known = getKnownPriceAsset(chainId, address);
  if (known) return known.canHaveChart;
  return getCoinGeckoPlatform(chainId) !== null;
}

// Fully resolved price identity for an asset, gathering everything the spot,
// market-data and history services need in one place so they can never drift
// apart. `address` is normalized to lowercase (or null for native).
export type ResolvedPriceIdentity = {
  key: string;
  chainId: number;
  address: string | null;
  // CoinGecko coin id (native / pegged / wrapped) when known, else null.
  coinGeckoId: string | null;
  // CoinGecko asset platform for contract-address lookups, else null.
  platform: string | null;
  canHaveChart: boolean;
  isStable: boolean;
  // Whether we expect to resolve a spot price at all (vs. "No price").
  hasMarketData: boolean;
};

// The single resolver shared by token-price, market-data and price-history.
export function resolvePriceIdentity(
  chainId: number,
  address: string | null,
): ResolvedPriceIdentity {
  const addr = address ? address.toLowerCase() : null;
  const known = getKnownPriceAsset(chainId, addr);
  const coinGeckoId = resolveCoinGeckoId(chainId, addr);
  const platform = getCoinGeckoPlatform(chainId);

  return {
    key: getPriceIdentityKey(chainId, addr),
    chainId,
    address: addr,
    coinGeckoId,
    platform,
    canHaveChart: canResolveChart(chainId, addr),
    isStable: known?.isStable ?? false,
    // A spot price is resolvable when we have a coin id (native/known) or ANY
    // contract address. The gateway prices ERC-20s, Solana SPL mints and TRON
    // tokens by chainId + address and decides server-side whether data exists,
    // so we must NOT gate on the local CoinGecko-platform list — doing so
    // silently denied imported SPL/TRON tokens (no platform) their market data.
    hasMarketData: coinGeckoId !== null || addr !== null,
  };
}

// Development-only diagnostics for price lookups. No-ops in production.
export function priceDebug(
  scope: string,
  detail: Record<string, unknown>,
): void {
  if (isDev) console.debug(`[price] ${scope}`, detail);
}

export function priceWarn(
  scope: string,
  detail: Record<string, unknown>,
): void {
  if (isDev) console.warn(`[price] ${scope}`, detail);
}
