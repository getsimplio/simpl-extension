// src/chains/ton/ton.prices.ts
//
// Native Toncoin market data (spot + chart) via the Simpl API TON proxy
// (`/v1/ton/prices/*`). The Simpl price gateway has NO generic TON support, so
// the Worker exposes dedicated TON price endpoints that front the upstream
// provider server-side. No provider key ships in this client bundle.
//
// Read-only: these endpoints never sign or send. All failures return null so the
// callers degrade cleanly (spot → "No price", history → graceful empty chart).

import { tonApiUrl, type TonChainConfig } from "./ton.config";

// Simpl API `/prices/spot?vs=usd,eur` response: a normalized `prices` map keyed
// by lowercase currency.
type ProxySpotResponse = {
  prices?: Record<string, number | undefined>;
};

// Simpl API `/prices/history` response: normalized points already sorted
// ascending by time. We still defensively re-validate and re-sort.
type ProxyHistoryResponse = {
  points?: Array<{ t?: number; price?: number } | [number, number]>;
};

export type TonSpotPrice = {
  price: number;
};

// Native Toncoin spot price in `vs` ("usd" | "eur"). Returns null on any
// failure (caller degrades to "No price" / keeps cache). The proxy returns both
// currencies in one call; we read the requested one from the `prices` map.
export async function getTonNativeSpot(
  config: TonChainConfig,
  vs: "usd" | "eur",
): Promise<TonSpotPrice | null> {
  const url = tonApiUrl(config, `/prices/spot?vs=usd,eur`);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as ProxySpotResponse;
    const price = payload.prices?.[vs];

    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? { price }
      : null;
  } catch {
    return null;
  }
}

// Native Toncoin price history for a range, normalized to ascending
// { t: unixSeconds, price } points (the shape price-history.service expects).
// The proxy maps the range to its `period` param and returns normalized points;
// we re-validate + re-sort defensively. Returns null on failure or when too few
// points exist to draw a line.
export async function getTonNativeHistory(
  config: TonChainConfig,
  range: "1d" | "7d" | "1m",
): Promise<{ t: number; price: number }[] | null> {
  const url = tonApiUrl(config, `/prices/history?period=${range}&vs=usd`);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as ProxyHistoryResponse;
    if (!Array.isArray(payload.points)) return null;

    const points: { t: number; price: number }[] = [];
    for (const entry of payload.points) {
      // Accept either the object form { t, price } or a [t, price] tuple.
      const t = Array.isArray(entry) ? entry[0] : entry?.t;
      const price = Array.isArray(entry) ? entry[1] : entry?.price;
      if (
        typeof t === "number" &&
        Number.isFinite(t) &&
        typeof price === "number" &&
        Number.isFinite(price)
      ) {
        points.push({ t, price });
      }
    }

    // Proxy already returns ascending time; re-sort to be safe.
    points.sort((a, b) => a.t - b.t);

    return points.length >= 2 ? points : null;
  } catch {
    return null;
  }
}
