// src/chains/ton/ton.jettons.ts
//
// Read-only Jetton (TON fungible token) balance discovery via the tonapi HTTP
// API: GET /v2/accounts/{address}/jettons returns every jetton the account
// holds, each with metadata, a verification flag and a USD spot price, in one
// call. We discover all holdings but surface ONLY trusted jettons (see
// ton.tokens.ts TRUSTED_JETTONS) so spam/unknown jettons never pollute the
// portfolio. Trusted jettons use OUR canonical metadata (anti-spoof); only the
// raw balance and live USD price are taken from the API.
//
// This module is balance-read only — it never signs or sends.

import type { TonChainConfig } from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { formatTonTokenAmount } from "./ton.format";
import { normalizeTonError, tonErrorFor } from "./ton.errors";
import { resolveTrustedJetton } from "./ton.tokens";
import type { TonJettonBalance } from "./ton.types";

// tonapi /v2/accounts/{address}/jettons response (only the fields we read).
type TonapiJettonMeta = {
  address?: string;
  symbol?: string;
  decimals?: number;
};

type TonapiJettonPrice = {
  prices?: { USD?: number };
};

type TonapiJettonBalance = {
  balance?: string;
  jetton?: TonapiJettonMeta;
  price?: TonapiJettonPrice;
};

type TonapiJettonsResponse = {
  balances?: TonapiJettonBalance[];
};

async function fetchAccountJettons(
  address: string,
  config: TonChainConfig,
): Promise<TonapiJettonBalance[]> {
  const url = `${config.tonapiBaseUrl.replace(/\/$/, "")}/v2/accounts/${encodeURIComponent(
    address,
  )}/jettons?currencies=usd`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.tonapiKey) {
    headers.Authorization = `Bearer ${config.tonapiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
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

  let payload: TonapiJettonsResponse;
  try {
    payload = (await response.json()) as TonapiJettonsResponse;
  } catch (error) {
    throw normalizeTonError(error, "TON_JETTON_FETCH_FAILED");
  }

  return payload.balances ?? [];
}

// Resolve the account's TRUSTED jetton balances (balance > 0). Non-trusted /
// spam / unknown jettons are dropped. Trusted jettons use our canonical
// metadata; balance + USD price come from the read API. Throws a coded TonError
// on transport/API failure (the adapter swallows it and degrades to native).
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
    const master = entry.jetton?.address;
    if (!master) continue;

    // Trust is decided by master address only — never by API symbol/name.
    const trusted = resolveTrustedJetton(master);
    if (!trusted) continue;

    let rawBalance: bigint;
    try {
      rawBalance = BigInt(entry.balance ?? "0");
    } catch {
      rawBalance = 0n;
    }
    if (rawBalance <= 0n) continue;

    const usd = entry.price?.prices?.USD;
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
