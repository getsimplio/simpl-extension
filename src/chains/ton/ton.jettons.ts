// src/chains/ton/ton.jettons.ts
//
// Read-only Jetton (TON fungible token) balance discovery via the Simpl API TON
// proxy: GET /v1/ton/jettons?address=<address>. The Worker fronts the upstream
// provider server-side (no provider key in this bundle) and already returns a
// normalized, trust-filtered set of jetton balances.
//
// Defense in depth: even though the proxy filters to trusted jettons, we STILL
// re-check every entry against our local TRUSTED_JETTONS allowlist by master
// address and render OUR canonical metadata (symbol/name/decimals) — never the
// API's — so a compromised/changed upstream can't slip a spoofed jetton into the
// portfolio. Only the raw balance and live USD price are taken from the proxy.
//
// This module is balance-read only — it never signs or sends.

import { tonApiUrl, type TonChainConfig } from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { formatTonTokenAmount } from "./ton.format";
import { normalizeTonError, tonErrorFor } from "./ton.errors";
import { resolveTrustedJetton } from "./ton.tokens";
import type { TonJettonBalance } from "./ton.types";

// Simpl API `/jettons` response (only the fields we read). The Worker normalizes
// provider shapes into a flat list; we accept a couple of field aliases to stay
// resilient to minor proxy shape differences.
type ProxyJetton = {
  // Jetton master contract address (any encoding).
  master?: string;
  address?: string;
  // Raw balance in the jetton's base units, as a decimal string.
  balance?: string;
  rawBalance?: string;
  // Live USD spot price for the jetton, when available.
  usdPrice?: number;
  price?: number;
};

type ProxyJettonsResponse = {
  jettons?: ProxyJetton[];
  balances?: ProxyJetton[];
};

async function fetchAccountJettons(
  address: string,
  config: TonChainConfig,
): Promise<ProxyJetton[]> {
  const url = tonApiUrl(
    config,
    `/jettons?address=${encodeURIComponent(address)}`,
  );

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw normalizeTonError(error, "TON_PROVIDER_UNAVAILABLE");
  }

  if (!response.ok) {
    throw tonErrorFor(
      response.status === 429 || response.status >= 500
        ? "TON_PROVIDER_UNAVAILABLE"
        : "TON_JETTON_FETCH_FAILED",
      `TON jetton API responded ${response.status}.`,
    );
  }

  let payload: ProxyJettonsResponse;
  try {
    payload = (await response.json()) as ProxyJettonsResponse;
  } catch (error) {
    throw normalizeTonError(error, "TON_JETTON_FETCH_FAILED");
  }

  return payload.jettons ?? payload.balances ?? [];
}

// Resolve the account's TRUSTED jetton balances (balance > 0). The proxy returns
// trust-filtered jettons; we re-verify each against our allowlist (anti-spoof)
// and use our canonical metadata. Throws a coded TonError on transport/API
// failure (the adapter swallows it and degrades to native).
export async function getTonJettonBalances(
  address: string,
  config: TonChainConfig,
): Promise<TonJettonBalance[]> {
  if (!isValidTonAddress(address)) {
    throw tonErrorFor("TON_INVALID_ADDRESS");
  }

  const raw = await fetchAccountJettons(address, config);
  const out: TonJettonBalance[] = [];

  for (const entry of raw) {
    const master = entry.master ?? entry.address;
    if (!master) continue;

    // Trust is decided by master address only — never by API symbol/name, and
    // never solely by the proxy having returned it.
    const trusted = resolveTrustedJetton(master);
    if (!trusted) continue;

    let rawBalance: bigint;
    try {
      rawBalance = BigInt(entry.rawBalance ?? entry.balance ?? "0");
    } catch {
      rawBalance = 0n;
    }
    if (rawBalance <= 0n) continue;

    const usd = entry.usdPrice ?? entry.price;
    const usdPrice =
      typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null;

    out.push({
      // Canonical user-friendly master from our registry (display/price/explorer).
      master: trusted.master,
      symbol: trusted.symbol,
      name: trusted.name,
      decimals: trusted.decimals,
      rawBalance,
      formatted: formatTonTokenAmount(rawBalance, trusted.decimals),
      usdPrice,
    });
  }

  return out;
}
