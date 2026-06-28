// src/chains/ton/ton.balance.ts
//
// Read-only native Toncoin balance loading via the toncenter HTTP API. Values
// are integer nanoton (bigint); formatting to a display string happens in the
// adapter. A toncenter failure surfaces as a normalized, coded TonError so the
// UI can show a clean error state instead of a raw network message.

import type { TonChainConfig } from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { nanoToTon } from "./ton.format";
import { normalizeTonError, tonErrorFor } from "./ton.errors";
import type { TonAccountState, TonBalance } from "./ton.types";

// toncenter getAddressInformation result (only the fields we read).
type AddressInformation = {
  balance?: string | number;
  state?: string;
  account_state?: string;
};

type ToncenterResponse = {
  ok?: boolean;
  error?: string;
  result?: AddressInformation;
};

// Map toncenter's contract state onto our TonAccountState. toncenter reports
// "uninitialized" for both never-seen and not-yet-deployed addresses, so we use
// the balance to distinguish "nonexist" (empty) from "uninit" (funded but not
// deployed). Receiving works in every state.
function mapState(raw: string | undefined, balance: bigint): TonAccountState {
  const value = (raw ?? "").toLowerCase();
  if (value === "active") return "active";
  if (value === "frozen") return "frozen";
  // "uninitialized" / "uninit" / unknown
  return balance > 0n ? "uninit" : "nonexist";
}

async function fetchAddressInformation(
  address: string,
  config: TonChainConfig,
): Promise<AddressInformation> {
  const url = `${config.apiBaseUrl.replace(/\/$/, "")}/getAddressInformation?address=${encodeURIComponent(
    address,
  )}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.apiKey) {
    headers["X-API-Key"] = config.apiKey;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw normalizeTonError(error, "TON_PROVIDER_UNAVAILABLE");
  }

  if (!response.ok) {
    // 429 / 5xx → provider unavailable; anything else → balance fetch failed.
    throw tonErrorFor(
      response.status === 429 || response.status >= 500
        ? "TON_PROVIDER_UNAVAILABLE"
        : "TON_BALANCE_FETCH_FAILED",
      `TON API responded ${response.status}.`,
    );
  }

  let payload: ToncenterResponse;
  try {
    payload = (await response.json()) as ToncenterResponse;
  } catch (error) {
    throw normalizeTonError(error, "TON_BALANCE_FETCH_FAILED");
  }

  if (!payload.ok || !payload.result) {
    throw tonErrorFor("TON_BALANCE_FETCH_FAILED", payload.error);
  }

  return payload.result;
}

// Native Toncoin balance (nanoton) + contract state for an address. Validates
// the address locally first, then reads from toncenter. Failures surface as a
// normalized TonError.
export async function getTonBalance(
  address: string,
  config: TonChainConfig,
): Promise<TonBalance> {
  if (!isValidTonAddress(address)) {
    throw tonErrorFor("TON_INVALID_ADDRESS");
  }

  const info = await fetchAddressInformation(address, config);

  let raw: bigint;
  try {
    raw = BigInt(info.balance ?? 0);
  } catch {
    raw = 0n;
  }
  // toncenter can return a negative balance placeholder (-1) for missing data.
  if (raw < 0n) raw = 0n;

  const state = mapState(info.state ?? info.account_state, raw);

  return {
    raw,
    formatted: nanoToTon(raw),
    decimals: 9,
    symbol: "TON",
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
