// src/chains/tron/tron.format.ts
//
// Amount conversion + formatting for TRON. All on-chain amounts are integers in
// the token's base unit (sun for TRX, 10^-6 for USDT). The UI must only ever
// see formatted decimal strings — never raw base units.

import { formatUnits, parseUnits } from "ethers";
import { TRX_DECIMALS } from "./tron.config";

// Parse a user-entered decimal display amount into integer base units for a
// token with `decimals`. Throws on a malformed amount.
export function toBaseUnits(displayAmount: string, decimals: number): bigint {
  const normalized = displayAmount.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Invalid amount.");
  }

  return parseUnits(normalized, decimals);
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
