import {
  getPriceIdentityKey,
  priceDebug,
  priceWarn,
} from "./price-identity";
import {
  getPriceHistory,
  type SimplHistoryRange,
} from "./simpl-market-api.service";
import { isTonChainId } from "../networks/chain-registry";
import { getRequiredTonConfigByChainId } from "../../chains/ton/ton.config";
import { getTonNativeHistory } from "../../chains/ton/ton.prices";

// Historical price points for the AssetDetailsPage chart. Uses the shared
// price identity (chainId + native marker / contract address) so the chart
// resolves to the exact same source as the spot price. Data comes from the
// Simpl API Gateway's /v1/prices/history endpoint — never a provider directly.
// Returns null when no history is available so the chart can be hidden
// gracefully.

export type PricePoint = {
  timestamp: number;
  price: number;
};

export type PriceHistoryRange = "1D" | "7D" | "1M";

// History changes slowly — a longer TTL also blunts upstream rate-limiting
// on repeat views.
const CACHE_TTL_MS = 15 * 60_000; // 15 minutes

// Map the UI's range labels onto the gateway's supported ranges.
function toBackendRange(range: PriceHistoryRange): SimplHistoryRange {
  if (range === "1D") return "1d";
  if (range === "7D") return "7d";
  return "1m";
}

type HistoryInput = {
  chainId: number;
  // ERC-20 contract address, or null for the chain's native asset.
  address: string | null;
  range: PriceHistoryRange;
};

function cacheKey(input: HistoryInput): string {
  return `simple:priceHistory:${getPriceIdentityKey(input.chainId, input.address)}:${input.range}`;
}

type CacheEnvelope = { updatedAt: number; points: PricePoint[] };

function readCacheEnvelope(input: HistoryInput): CacheEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(input));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (!parsed || !Array.isArray(parsed.points)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readFreshCache(input: HistoryInput): PricePoint[] | null {
  const envelope = readCacheEnvelope(input);
  if (!envelope) return null;
  if (Date.now() - envelope.updatedAt > CACHE_TTL_MS) return null;
  return envelope.points;
}

// Stale cache is served only when a live fetch fails (e.g. a 429) so the chart
// survives rate-limiting instead of disappearing.
function readStaleCache(input: HistoryInput): PricePoint[] | null {
  return readCacheEnvelope(input)?.points ?? null;
}

function writeCache(input: HistoryInput, points: PricePoint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(input),
      JSON.stringify({ updatedAt: Date.now(), points }),
    );
  } catch {
    // optional
  }
}

// Convert the gateway's history points ({ t, price }) into the chart's
// PricePoint shape. Needs at least two finite points to draw a line.
function normalizePoints(
  points: { t: number; price: number }[] | undefined,
): PricePoint[] | null {
  if (!Array.isArray(points)) return null;

  const out: PricePoint[] = [];
  for (const entry of points) {
    if (
      entry &&
      typeof entry.t === "number" &&
      Number.isFinite(entry.t) &&
      typeof entry.price === "number" &&
      Number.isFinite(entry.price)
    ) {
      out.push({ timestamp: entry.t, price: entry.price });
    }
  }

  return out.length >= 2 ? out : null;
}

export class PriceHistoryService {
  async getAssetPriceHistory(input: HistoryInput): Promise<PricePoint[] | null> {
    // Let the gateway decide whether history exists — no client-side allow-list.
    // Stablecoins, non-native tokens and any asset with a resolvable identity
    // all get a request; the gateway returns points (→ line chart) or empty
    // (→ null, graceful). This is what lets USDT/MNT etc. show a line chart even
    // though they have no OHLC candles.
    const fresh = readFreshCache(input);
    if (fresh) {
      priceDebug("history cache", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
        points: fresh.length,
      });
      return fresh;
    }

    // Native TON history comes from tonapi — the Simpl gateway has no TON
    // support. Jettons (address != null) are intentionally left to the gateway
    // (no chart yet), so they fall through and resolve to a graceful empty chart.
    if (isTonChainId(input.chainId) && input.address === null) {
      return this.getTonNativeHistory(input);
    }

    try {
      const history = await getPriceHistory({
        chainId: input.chainId,
        address: input.address,
        range: toBackendRange(input.range),
        vs: "usd",
      });

      if (!history) {
        priceWarn("history fetch failed", {
          chainId: input.chainId,
          address: input.address,
          range: input.range,
        });
        // Survive rate-limiting / outages by reusing stale cache when present.
        return readStaleCache(input);
      }

      const points = normalizePoints(history.points);
      if (!points) {
        priceDebug("history empty", {
          chainId: input.chainId,
          address: input.address,
          range: input.range,
        });
        return readStaleCache(input);
      }

      writeCache(input, points);
      priceDebug("history ok", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
        points: points.length,
        source: history.source,
      });
      return points;
    } catch (error) {
      priceWarn("history error", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
        error: String(error),
      });
      return readStaleCache(input);
    }
  }

  // Native TON history via tonapi, normalized + cached exactly like the gateway
  // path so range switching, caching and stale-fallback all behave identically.
  private async getTonNativeHistory(
    input: HistoryInput,
  ): Promise<PricePoint[] | null> {
    try {
      const config = getRequiredTonConfigByChainId(input.chainId);
      // The TON chart supports the three UI ranges; map them directly (the
      // gateway's wider SimplHistoryRange "max" is never produced here).
      const tonRange =
        input.range === "1D" ? "1d" : input.range === "7D" ? "7d" : "1m";
      const raw = await getTonNativeHistory(
        config,
        tonRange,
        Math.floor(Date.now() / 1000),
      );

      const points = normalizePoints(raw ?? undefined);
      if (!points) {
        priceDebug("history empty (ton)", { range: input.range });
        return readStaleCache(input);
      }

      writeCache(input, points);
      priceDebug("history ok (ton)", {
        range: input.range,
        points: points.length,
      });
      return points;
    } catch (error) {
      priceWarn("history error (ton)", {
        range: input.range,
        error: String(error),
      });
      return readStaleCache(input);
    }
  }
}

export const priceHistoryService = new PriceHistoryService();
