// src/chains/tron/tron.wc.ts
//
// Pure helpers that normalize the various shapes a TRON WalletConnect request
// payload can arrive in, into the value our signing layer expects. TRON dApps
// (Tronscan / TronLink-compatible) send params as the value itself, a one-item
// array, or an object keyed by `transaction` / `message`. These functions never
// touch key material — they only reshape public request data.

import { tronError } from "./tron.errors";

// Unwrap a one-item array, otherwise pass through.
function unwrap(params: unknown): unknown {
  return Array.isArray(params) ? params[0] : params;
}

// Extract the unsigned TRON transaction object from a tron_signTransaction /
// tron_sendTransaction request. Requires a `txID` (the dApp builds the tx and
// asks us only to sign it). Throws INVALID_TRON_PAYLOAD on any other shape.
export function extractTronWcTransaction(
  params: unknown,
): Record<string, unknown> {
  const value = unwrap(params);

  if (!value || typeof value !== "object") {
    throw tronError("INVALID_TRON_PAYLOAD", "Invalid TRON transaction payload.");
  }

  const record = value as Record<string, unknown>;
  const tx =
    record.transaction && typeof record.transaction === "object"
      ? (record.transaction as Record<string, unknown>)
      : record;

  if (!tx || typeof tx !== "object" || typeof tx.txID !== "string") {
    throw tronError(
      "INVALID_TRON_PAYLOAD",
      "TRON transaction payload is missing a txID.",
    );
  }

  return tx;
}

// Extract the message string from a tron_signMessage request. Accepts a bare
// string, [string], or { message | data | text: string }. Throws
// INVALID_TRON_PAYLOAD on any other shape.
export function extractTronWcMessage(params: unknown): string {
  let value = unwrap(params);

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    value = record.message ?? record.data ?? record.text;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw tronError("INVALID_TRON_PAYLOAD", "Invalid TRON message payload.");
  }

  return value;
}

// A compact, NON-SENSITIVE description of a request payload for debug storage:
// the top-level key names only (never values, which for a message could be
// sensitive and for a signature must never be stored).
export function describeTronWcPayloadShape(params: unknown): string {
  const value = unwrap(params);

  if (value === null) return "null";
  if (Array.isArray(params)) return `array(${typeof value})`;
  if (typeof value === "object") {
    return `object{${Object.keys(value as Record<string, unknown>).sort().join(",")}}`;
  }

  return typeof value;
}
