// src/chains/ton/ton.format.ts
//
// Nanoton <-> TON conversion + generic base-unit helpers. On-chain amounts are
// always integer base units (bigint); the UI only ever sees formatted decimal
// strings. Integer-only math avoids float precision bugs.

import { TON_DECIMALS } from "./ton.config";
import { tonErrorFor } from "./ton.errors";

// Parse a user-entered decimal amount into integer base units for `decimals`.
// Throws a coded TON_INVALID_AMOUNT error on a malformed amount, too many
// decimals, or a non-positive value.
export function parseTonTokenAmount(
  displayAmount: string,
  decimals: number,
): bigint {
  const normalized = displayAmount.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw tonErrorFor("TON_INVALID_AMOUNT");
  }

  const [whole, fraction = ""] = normalized.split(".");

  if (fraction.length > decimals) {
    throw tonErrorFor(
      "TON_INVALID_AMOUNT",
      `Amount has too many decimals (max ${decimals}).`,
    );
  }

  const base = 10n ** BigInt(decimals);
  const paddedFraction = fraction.padEnd(decimals, "0");
  const value = BigInt(whole) * base + BigInt(paddedFraction || "0");

  if (value <= 0n) {
    throw tonErrorFor("TON_INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  return value;
}

// Convert integer base units to a decimal string with up to `decimals` places,
// trailing zeros trimmed (but always at least "0").
export function formatTonTokenAmount(
  raw: bigint | string,
  decimals: number,
): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);

  const whole = abs / base;
  const fraction = abs % base;

  let fractionStr = fraction.toString().padStart(decimals, "0");
  fractionStr = fractionStr.replace(/0+$/, "");

  const body = fractionStr.length > 0 ? `${whole}.${fractionStr}` : `${whole}`;

  return negative ? `-${body}` : body;
}

// Parse a user-entered TON display amount into integer nanoton.
export function tonToNano(displayAmount: string): bigint {
  return parseTonTokenAmount(displayAmount, TON_DECIMALS);
}

// Convert integer nanoton to a TON decimal string (up to 9 decimals, trimmed).
export function nanoToTon(nano: bigint | string): string {
  return formatTonTokenAmount(nano, TON_DECIMALS);
}
