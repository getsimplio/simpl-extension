// src/chains/ton/ton.tokens.ts
//
// TON token registry: the native Toncoin plus a curated allowlist of TRUSTED
// Jettons (TON's fungible-token standard). Trust is keyed on the Jetton MASTER
// CONTRACT ADDRESS — never on symbol/name, which any spam jetton can spoof
// ("USD₮", "Tether", etc.). For a trusted jetton we always use OUR canonical
// metadata (symbol/name/decimals), not whatever the on-chain/API metadata says.
//
// Read-only: this registry decides what shows in the portfolio. Held jettons not
// in this list are intentionally dropped so spam/unknown jettons never pollute
// the wallet. Sending jettons is NOT implemented in this PR (the shape is
// send-ready: a master address + decimals is all a future transfer needs).

import { Address } from "@ton/core";

export type TonTokenType = "native" | "jetton";

export type TonToken = {
  type: TonTokenType;
  symbol: string;
  name: string;
  decimals: number;
  // Jetton master contract address (user-friendly form), or null for native.
  masterAddress: string | null;
};

export const TON_NATIVE_TOKEN: TonToken = {
  type: "native",
  symbol: "TON",
  name: "Toncoin",
  decimals: 9,
  masterAddress: null,
};

// A curated, trusted Jetton. `master` is the canonical user-friendly master
// address (used for display, price identity and explorer links). `coinGeckoId`
// is informational; values are resolved live from the read API. Decimals are
// canonical and verified against the on-chain jetton metadata.
export type TrustedJetton = {
  symbol: string;
  name: string;
  decimals: number;
  master: string;
  coinGeckoId?: string;
  isStable?: boolean;
};

// Initial trusted Jettons for the read-only MVP: USDT, NOT, DOGS. Master
// addresses + decimals verified against tonapi (`/v2/jettons/{master}`); all
// three are tonapi-whitelisted. Append new trusted jettons here.
export const TRUSTED_JETTONS: TrustedJetton[] = [
  {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    master: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    coinGeckoId: "tether",
    isStable: true,
  },
  {
    symbol: "NOT",
    name: "Notcoin",
    decimals: 9,
    master: "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT",
    coinGeckoId: "notcoin",
  },
  {
    symbol: "DOGS",
    name: "Dogs",
    decimals: 9,
    master: "EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS",
    coinGeckoId: "dogs-2",
  },
];

// Canonical raw form ("0:<hex>") of a TON address, used to compare master
// addresses regardless of the encoding (raw vs bounceable EQ… vs non-bounceable
// UQ…) the API happens to return. Returns null for anything unparseable.
function toRawAddress(address: string): string | null {
  try {
    return Address.parse(address.trim()).toRawString();
  } catch {
    return null;
  }
}

// Trusted jettons indexed by their raw master address for O(1), encoding-
// independent lookup. Built once at module load.
const TRUSTED_BY_RAW_MASTER = new Map<string, TrustedJetton>();
for (const jetton of TRUSTED_JETTONS) {
  const raw = toRawAddress(jetton.master);
  if (raw) TRUSTED_BY_RAW_MASTER.set(raw, jetton);
}

// Resolve a trusted jetton by any encoding of its master address, or null when
// the master is not on the trusted allowlist (i.e. spam/unknown → dropped).
export function resolveTrustedJetton(
  masterAddress: string,
): TrustedJetton | null {
  const raw = toRawAddress(masterAddress);
  return raw ? TRUSTED_BY_RAW_MASTER.get(raw) ?? null : null;
}
