// src/chains/ton/ton.balance.ts
//
// Read-only native Toncoin balance loading via the Simpl API TON proxy
// (`/v1/ton/account`). The Worker fronts the upstream provider server-side, so
// no provider key ships in this bundle. Values are integer nanoton (bigint);
// formatting to a display string happens in the adapter. A proxy failure
// surfaces as a
// normalized, coded TonError so the UI can show a clean error state instead of a
// raw network message.

import { tonApiUrl, type TonChainConfig } from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { nanoToTon } from "./ton.format";
import { normalizeTonError, tonErrorFor } from "./ton.errors";
import type { TonAccountState, TonBalance } from "./ton.types";

// Normalized account info from the Simpl API TON proxy `/account` endpoint
// (only the fields we read). The Worker returns a stable shape regardless of the
// underlying provider: nanoton balance as a decimal string, a mapped contract
// state, the wallet seqno and an isActive convenience flag.
type ProxyAccountInfo = {
  state?: string;
  balanceNano?: string | number;
  seqno?: number;
  isActive?: boolean;
};

// Map the proxy's contract state onto our TonAccountState. The proxy already
// normalizes provider quirks (the upstream reports "uninitialized" for both
// never-seen and not-yet-deployed addresses), so we trust `state` and only use
// the balance to disambiguate the uninitialized case. Receiving works in every
// state.
function mapState(raw: string | undefined, balance: bigint): TonAccountState {
  const value = (raw ?? "").toLowerCase();
  if (value === "active") return "active";
  if (value === "frozen") return "frozen";
  if (value === "uninit" || value === "uninitialized") {
    return balance > 0n ? "uninit" : "nonexist";
  }
  if (value === "nonexist") return "nonexist";
  // Unknown → distinguish by balance like the provider path did.
  return balance > 0n ? "uninit" : "nonexist";
}

async function fetchAccountInfo(
  address: string,
  config: TonChainConfig,
): Promise<ProxyAccountInfo> {
  const url = tonApiUrl(
    config,
    `/account?address=${encodeURIComponent(address)}`,
  );

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
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

  let payload: ProxyAccountInfo;
  try {
    payload = (await response.json()) as ProxyAccountInfo;
  } catch (error) {
    throw normalizeTonError(error, "TON_BALANCE_FETCH_FAILED");
  }

  return payload;
}

// Native Toncoin balance (nanoton) + contract state for an address. Validates
// the address locally first, then reads from the Simpl API TON proxy. Failures
// surface as a normalized TonError.
export async function getTonBalance(
  address: string,
  config: TonChainConfig,
): Promise<TonBalance> {
  if (!isValidTonAddress(address)) {
    throw tonErrorFor("TON_INVALID_ADDRESS");
  }

  const info = await fetchAccountInfo(address, config);

  let raw: bigint;
  try {
    raw = BigInt(info.balanceNano ?? 0);
  } catch {
    raw = 0n;
  }
  // Guard against a negative placeholder for missing data.
  if (raw < 0n) raw = 0n;

  const state = mapState(info.state, raw);

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
