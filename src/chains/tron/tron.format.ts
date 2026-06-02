// src/chains/tron/tron.format.ts
//
// Amount conversion + formatting for TRON. All on-chain amounts are integers in
// the token's base unit (sun for TRX, 10^-6 for USDT). The UI must only ever
// see formatted decimal strings — never raw base units.

import { formatUnits, parseUnits } from "ethers";
import { TRX_DECIMALS } from "./tron.config";
import { tronError } from "./tron.errors";

// Parse a user-entered decimal display amount into integer base units for a
// token with `decimals`. Throws a coded INVALID_AMOUNT error on a malformed
// amount, more decimals than the token supports, or a non-positive value.
// Integer-only math (via ethers' parseUnits) avoids float precision bugs.
export function toBaseUnits(displayAmount: string, decimals: number): bigint {
  const normalized = displayAmount.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw tronError("INVALID_AMOUNT", "Enter a valid amount.");
  }

  const fraction = normalized.split(".")[1] ?? "";

  if (fraction.length > decimals) {
    throw tronError(
      "INVALID_AMOUNT",
      `Amount has too many decimals (max ${decimals}).`,
    );
  }

  const baseUnits = parseUnits(normalized, decimals);

  if (baseUnits <= 0n) {
    throw tronError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  return baseUnits;
}

// Format integer base units back to a human-readable decimal string.
export function fromBaseUnits(baseUnits: bigint | string, decimals: number): string {
  return formatUnits(BigInt(baseUnits), decimals);
}

// Convenience helpers for the native TRX asset (6 decimals / sun).
export function trxToSun(displayAmount: string): bigint {
  return toBaseUnits(displayAmount, TRX_DECIMALS);
}

export function sunToTrx(sun: bigint | string): string {
  return fromBaseUnits(sun, TRX_DECIMALS);
}
