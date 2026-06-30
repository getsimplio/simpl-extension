// src/chains/ton/ton.jettons.ts
//
// Read-only Jetton (TON fungible token) balance discovery via the centralized
// TON API client (Simpl gateway `GET /v1/ton/jettons?address=`). The Worker
// fronts the upstream provider server-side (no provider key in this bundle) and
// already returns a normalized, trust-filtered set of jetton balances.
//
// Defense in depth: even though the gateway filters to trusted jettons, we STILL
// re-check every entry against our local TRUSTED_JETTONS allowlist by master
// address and render OUR canonical metadata (symbol/name/decimals) — never the
// API's — so a compromised/changed upstream can't slip a spoofed jetton into the
// portfolio. Only the raw balance and live USD price are taken from the gateway.
//
// This module is balance-read only — it never signs or sends.

import type { TonChainConfig } from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { formatTonTokenAmount } from "./ton.format";
import { tonErrorFor } from "./ton.errors";
import { tonApiClient } from "../../core/ton/tonApiClient";
import { resolveTrustedJetton } from "./ton.tokens";
import type { TonJettonBalance } from "./ton.types";

// Resolve the account's TRUSTED jetton balances (balance > 0). The gateway
// returns trust-filtered jettons; we re-verify each against our allowlist
// (anti-spoof) and use our canonical metadata. Throws a coded TonError on
// transport/API failure (the adapter swallows it and degrades to native). An
// empty account / no jettons resolves to an empty array, never an error.
export async function getTonJettonBalances(
  address: string,
  config: TonChainConfig,
): Promise<TonJettonBalance[]> {
  if (!isValidTonAddress(address)) {
    throw tonErrorFor("TON_INVALID_ADDRESS");
  }

  const payload = await tonApiClient.getJettons(config, address);
  const raw = payload.jettons ?? payload.balances ?? [];
  const out: TonJettonBalance[] = [];

  for (const entry of raw) {
    const master = entry.master ?? entry.address;
    if (!master) continue;

    // Trust is decided by master address only — never by API symbol/name, and
    // never solely by the gateway having returned it.
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
