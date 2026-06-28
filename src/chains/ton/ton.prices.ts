// src/chains/ton/ton.prices.ts
//
// Native Toncoin market data (spot + chart) via the tonapi read API. This exists
// because the Simpl price gateway has NO TON support — it returns "Unsupported
// asset" for chainId "ton"/"the-open-network" — so the native price/chart paths
// that work for EVM/TRON/Solana would otherwise leave TON on "No price" /
// "Chart unavailable" forever. tonapi is the same provider already used for
// Jetton discovery, so this adds no new dependency or origin.
//
// Read-only: these endpoints never sign or send. All failures return null so the
// callers degrade cleanly (spot → "No price", history → graceful empty chart).

import type { TonChainConfig } from "./ton.config";

// tonapi /v2/rates response (only the fields we read).
type TonapiRates = {
  rates?: Record<
    string,
    { prices?: Record<string, number> }
  >;
};

// tonapi /v2/rates/chart response: points are [unixSeconds, price], newest-first.
type TonapiChart = {
  points?: [number, number][];
};

export type TonSpotPrice = {
  price: number;
};

function authHeaders(config: TonChainConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.tonapiKey) {
    headers.Authorization = `Bearer ${config.tonapiKey}`;
  }
  return headers;
}

// Native Toncoin spot price in `vs` ("usd" | "eur"). Returns null on any
// failure (caller degrades to "No price" / keeps cache).
export async function getTonNativeSpot(
  config: TonChainConfig,
  vs: "usd" | "eur",
): Promise<TonSpotPrice | null> {
  const url = `${config.tonapiBaseUrl.replace(/\/$/, "")}/v2/rates?tokens=ton&currencies=${vs}`;

  try {
    const response = await fetch(url, { headers: authHeaders(config) });
    if (!response.ok) return null;

    const payload = (await response.json()) as TonapiRates;
    const prices = payload.rates?.TON?.prices;
    const price = prices?.[vs.toUpperCase()];

    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? { price }
      : null;
  } catch {
    return null;
  }
}

// Number of chart points to request per range (tonapi samples evenly across the
// requested window). Kept modest — enough for a smooth line, light on the API.
const RANGE_SECONDS: Record<"1d" | "7d" | "1m", number> = {
  "1d": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "1m": 30 * 24 * 60 * 60,
};
const RANGE_POINTS: Record<"1d" | "7d" | "1m", number> = {
  "1d": 48,
  "7d": 56,
  "1m": 60,
};

// Native Toncoin price history for a range, normalized to ascending
// { t: unixSeconds, price } points (the shape price-history.service expects).
// Returns null on failure or when too few points exist to draw a line.
export async function getTonNativeHistory(
  config: TonChainConfig,
  range: "1d" | "7d" | "1m",
  nowSeconds: number,
): Promise<{ t: number; price: number }[] | null> {
  const start = nowSeconds - RANGE_SECONDS[range];
  const url =
    `${config.tonapiBaseUrl.replace(/\/$/, "")}/v2/rates/chart` +
    `?token=ton&currency=usd&start_date=${start}&end_date=${nowSeconds}` +
    `&points_count=${RANGE_POINTS[range]}`;

  try {
    const response = await fetch(url, { headers: authHeaders(config) });
    if (!response.ok) return null;

    const payload = (await response.json()) as TonapiChart;
    if (!Array.isArray(payload.points)) return null;

    const points: { t: number; price: number }[] = [];
    for (const entry of payload.points) {
      const t = entry?.[0];
      const price = entry?.[1];
      if (
        typeof t === "number" &&
        Number.isFinite(t) &&
        typeof price === "number" &&
        Number.isFinite(price)
      ) {
        points.push({ t, price });
      }
    }

    // tonapi returns newest-first; the chart needs ascending time.
    points.sort((a, b) => a.t - b.t);

    return points.length >= 2 ? points : null;
  } catch {
    return null;
  }
}
