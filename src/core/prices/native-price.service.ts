import {
  BASE_CHAIN_ID,
  BNB_SMART_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "../networks/chain-registry";

export type NativeAssetQuote = {
  chainId: number;
  symbol: string;
  priceUsd: number;
  priceEur: number;
  updatedAt: number;
};

const CACHE_TTL_MS = 60_000;

function getNativePriceCacheKey(chainId: number): string {
  return `simple:nativePrice:${chainId}`;
}

function getCoinGeckoIdByChainId(chainId: number): string | null {
  if (
    chainId === ETHEREUM_MAINNET_CHAIN_ID ||
    chainId === BASE_CHAIN_ID ||
    chainId === SEPOLIA_CHAIN_ID
  ) {
    return "ethereum";
  }

  if (chainId === BNB_SMART_CHAIN_ID) {
    return "binancecoin";
  }

  return null;
}

function readCachedQuote(chainId: number): NativeAssetQuote | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getNativePriceCacheKey(chainId));

    if (!raw) return null;

    const parsed = JSON.parse(raw) as NativeAssetQuote;

    if (
      !parsed ||
      parsed.chainId !== chainId ||
      typeof parsed.symbol !== "string" ||
      typeof parsed.priceUsd !== "number" ||
      typeof parsed.priceEur !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isFreshQuote(quote: NativeAssetQuote): boolean {
  return Date.now() - quote.updatedAt < CACHE_TTL_MS;
}

function writeCachedQuote(quote: NativeAssetQuote): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getNativePriceCacheKey(quote.chainId),
      JSON.stringify(quote),
    );
  } catch {
    // Price cache is optional.
  }
}

export class NativePriceService {
  getCachedNativeQuote(chainId: number): NativeAssetQuote | null {
    return readCachedQuote(chainId);
  }

  async getNativeQuote(input: {
    chainId: number;
    symbol: string;
  }): Promise<NativeAssetQuote | null> {
    const coinId = getCoinGeckoIdByChainId(input.chainId);

    if (!coinId) {
      return null;
    }

    const cached = readCachedQuote(input.chainId);

    if (cached && isFreshQuote(cached)) {
      return cached;
    }

    const url = new URL("https://api.coingecko.com/api/v3/simple/price");

    url.searchParams.set("ids", coinId);
    url.searchParams.set("vs_currencies", "usd,eur");

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        return cached;
      }

      const data = (await response.json()) as Record<
        string,
        {
          usd?: number;
          eur?: number;
        }
      >;

      const priceUsd = data[coinId]?.usd;
      const priceEur = data[coinId]?.eur;

      if (typeof priceUsd !== "number" || typeof priceEur !== "number") {
        return cached;
      }

      const quote: NativeAssetQuote = {
        chainId: input.chainId,
        symbol: input.symbol,
        priceUsd,
        priceEur,
        updatedAt: Date.now(),
      };

      writeCachedQuote(quote);

      return quote;
    } catch {
      return cached;
    }
  }
}

export const nativePriceService = new NativePriceService();