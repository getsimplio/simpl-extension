// src/chains/ton/ton.address.ts
//
// TON address helpers: user-friendly/raw address validation & normalization,
// display shortening, and the BIP-44 Ed25519 derivation path. These are pure,
// PUBLIC-key-only utilities — no secret key material here.
//
// TON addresses come in two forms: raw ("0:<hex>") and user-friendly base64url
// ("EQ…" bounceable / "UQ…" non-bounceable, with a testnet flag). For receiving
// into a wallet the convention is the non-bounceable mainnet form (UQ…), which
// is what derivation produces. Validation accepts any well-formed TON address
// (friendly or raw) and rejects EVM / Solana / TRON / Bitcoin addresses, since
// @ton/core's parser only accepts valid TON encodings.

import { Address } from "@ton/core";
import { TON_COIN_TYPE } from "./ton.config";

// True when `address` is a valid TON address (user-friendly EQ…/UQ… or raw
// 0:<hex>). Rejects empty input and any non-TON encoding.
export function isValidTonAddress(address: string): boolean {
  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return false;
  }

  try {
    if (Address.isFriendly(trimmed) || Address.isRaw(trimmed)) {
      Address.parse(trimmed);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Canonical user-friendly, non-bounceable mainnet form (UQ…) of a valid TON
// address. Throws on invalid input. Non-bounceable is the receive convention so
// funds sent to a not-yet-deployed wallet are not bounced back.
export function normalizeTonAddress(address: string): string {
  const trimmed = address.trim();

  if (!isValidTonAddress(trimmed)) {
    throw new Error("Invalid TON address.");
  }

  return Address.parse(trimmed).toString({
    urlSafe: true,
    bounceable: false,
  });
}

// Compact display form "UQAb…Wxyz" for space-constrained UI.
export function shortenTonAddress(address: string): string {
  const trimmed = address.trim();

  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

// BIP-44 Ed25519 derivation path for TON (SLIP-0010). The Simpl account index
// maps to the BIP-44 account level; all segments are hardened, as SLIP-0010
// Ed25519 requires. This is the wallet's internal convention for deriving a TON
// key from the shared BIP-39 seed (mirrors the Solana path layout):
//   account 0 → m/44'/607'/0'/0'
//   account n → m/44'/607'/n'/0'
export function getTonDerivationPath(accountIndex: number): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("Account index must be a non-negative integer.");
  }

  return `m/44'/${TON_COIN_TYPE}'/${accountIndex}'/0'`;
}
