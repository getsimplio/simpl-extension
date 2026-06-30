// src/chains/ton/ton.balance.ts
//
// Read-only native Toncoin balance loading via the centralized TON API client
// (Simpl gateway `/v1/ton/account`). The Worker fronts the upstream provider
// server-side, so no provider key ships in this bundle. Values are integer
// nanoton (bigint); formatting to a display string happens in the adapter. A
// gateway failure surfaces as a normalized, coded TonError so the UI can show a
// clean error state instead of a raw network message.

import type { TonChainConfig } from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { nanoToTon } from "./ton.format";
import { tonErrorFor } from "./ton.errors";
import { tonApiClient } from "../../core/ton/tonApiClient";
import type { TonAccountState, TonBalance } from "./ton.types";

// Map the gateway's contract state onto our TonAccountState. The gateway already
// normalizes provider quirks (the upstream reports "uninitialized" for both
// never-seen and not-yet-deployed addresses), so we trust `state` and only use
// the balance to disambiguate the uninitialized case. Receiving works in every
// state.
export function mapTonAccountState(
  raw: string | undefined,
  balance: bigint,
): TonAccountState {
  const value = (raw ?? "").toLowerCase();
  if (value === "active") return "active";
  if (value === "frozen") return "frozen";
  if (value === "nonexist") return "nonexist";
  // "uninit" / "uninitialized" / unknown → disambiguate by balance.
  return balance > 0n ? "uninit" : "nonexist";
}

// Native Toncoin balance (nanoton) + contract state for an address. Validates
// the address locally first, then reads from the Simpl API TON gateway. Failures
// surface as a normalized TonError.
export async function getTonBalance(
  address: string,
  config: TonChainConfig,
): Promise<TonBalance> {
  if (!isValidTonAddress(address)) {
    throw tonErrorFor("TON_INVALID_ADDRESS");
  }

  const info = await tonApiClient.getAccount(config, address);

  let raw: bigint;
  try {
    raw = BigInt(info.balanceNano ?? 0);
  } catch {
    raw = 0n;
  }
  // Guard against a negative placeholder for missing data.
  if (raw < 0n) raw = 0n;

  const state = mapTonAccountState(info.state, raw);

  return {
    raw,
    formatted: nanoToTon(raw),
    decimals: 9,
    symbol: "GRAM",
    state,
  };
}

// Native Toncoin balance in nanoton only (no formatting / state).
export async function getTonBalanceNano(
  address: string,
  config: TonChainConfig,
): Promise<bigint> {
  return (await getTonBalance(address, config)).raw;
}
