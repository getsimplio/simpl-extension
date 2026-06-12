import { priceDebug, priceWarn } from "./price-identity";
import { getBatchPrices } from "./simpl-market-api.service";

// ERC-20 spot price resolution by stable identity (chainId + lowercase
// contract address), NOT by symbol — symbols collide across chains (ETH/USDT/
// USDC exist on many networks). Prices come from the Simpl API Gateway's batch
// endpoint, which is keyed by chainId + contract address server-side, so pegged
// tokens (e.g. Binance-Peg ETH on BSC) resolve to their underlying market price
// without the client knowing any provider coin ids.

export type TokenPrice = {
  priceUsd: number;
  // EUR is not consumed for token display (the EUR valuation toggle derives a
  // single global rate from the native quote), so it is optional and only the
  // USD price is fetched per token. Kept for backward-compatible cache reads.
  priceEur?: number;
  updatedAt: number;
};

const CACHE_TTL_MS = 60_000;

function priceCacheKey(chainId: number, address: string): string {
  return `simple:tokenPrice:${chainId}:${address.toLowerCase()}`;
}

function readCachedPrice(chainId: number, address: string): TokenPrice | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(priceCacheKey(chainId, address));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as TokenPrice;
    if (
      !parsed ||
      typeof parsed.priceUsd !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeCachedPrice(
  chainId: number,
  address: string,
  price: TokenPrice,
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      priceCacheKey(chainId, address),
      JSON.stringify(price),
    );
  } catch {
    // Price cache is optional.
  }
}

function isFresh(price: TokenPrice): boolean {
  return Date.now() - price.updatedAt < CACHE_TTL_MS;
}

type PriceMap = Record<string, TokenPrice>;

export class TokenPriceService {
  // Synchronous cache read for instant first paint (may be stale).
  getCachedTokenPrices(chainId: number, addresses: string[]): PriceMap {
    const out: PriceMap = {};
    for (const address of addresses) {
      const cached = readCachedPrice(chainId, address);
      if (cached) out[address.toLowerCase()] = cached;
    }
    return out;
  }

  // Resolve USD prices for a batch of ERC-20 addresses on one chain. Returns a
  // map keyed by lowercase address. Missing/unknown tokens are simply absent
  // from the map (callers fall back to "No price"). A failed/partial batch
  // serves any stale cache we still hold so the UI doesn't flicker to "—".
  async getTokenPrices(input: {
    chainId: number;
    addresses: string[];
  }): Promise<PriceMap> {
    const { chainId } = input;
    // De-dupe by lowercase identity but KEEP each address's original casing for
    // the gateway request. EVM 0x addresses are case-insensitive, but Solana SPL
    // mints and TRON base58 addresses are CASE-SENSITIVE — lowercasing them
    // corrupts the identity so the gateway can't price the token (this is what
    // left imported SPL tokens stuck on "No price"). We map lowercase-key →
    // original address and only ever send the original to the gateway.
    const originalByKey = new Map<string, string>();
    for (const raw of input.addresses) {
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!originalByKey.has(key)) originalByKey.set(key, raw);
    }
    const addresses = Array.from(originalByKey.keys());

    if (addresses.length === 0) return {};

    const result: PriceMap = {};
    const stale: string[] = [];

    // 1. Serve fresh cache; queue stale/missing for refetch.
    for (const address of addresses) {
      const cached = readCachedPrice(chainId, address);
      if (cached && isFresh(cached)) {
        result[address] = cached;
      } else {
        stale.push(address);
      }
    }

    if (stale.length === 0) return result;

    const now = Date.now();
    const stillMissing = new Set(stale);

    // 2. One batch request to the Simpl API Gateway for every stale address.
    try {
      const batch = await getBatchPrices(
        // Send the ORIGINAL-cased address so case-sensitive Solana/TRON mints
        // reach the gateway intact; EVM addresses are canonicalized server-side.
        stale.map((key) => ({ chainId, address: originalByKey.get(key) ?? key })),
        "usd",
      );

      for (const item of batch?.items ?? []) {
        const address = item.address?.toLowerCase();
        if (!address || !stillMissing.has(address)) continue;
        if (typeof item.price !== "number" || !Number.isFinite(item.price)) {
          continue;
        }
        const price: TokenPrice = { priceUsd: item.price, updatedAt: now };
        result[address] = price;
        writeCachedPrice(chainId, address, price);
        stillMissing.delete(address);
      }
    } catch (error) {
      priceWarn("token batch failed", { chainId, error: String(error) });
    }

    if (stillMissing.size > 0) {
      priceWarn("not found", { chainId, addresses: Array.from(stillMissing) });
    }

    // Serve any stale cache we still have for addresses that failed to refresh.
    for (const address of stillMissing) {
      const cached = readCachedPrice(chainId, address);
      if (cached) result[address] = cached;
    }

    priceDebug("token lookup", {
      chainId,
      requested: addresses.length,
      resolved: Object.keys(result).length,
    });

    return result;
  }
}

export const tokenPriceService = new TokenPriceService();
