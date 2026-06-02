// src/chains/tron/tron.errors.ts
//
// Normalize the many shapes of TRON / TronWeb / TronGrid errors into a small set
// of user-facing messages with a stable machine-readable `code`, consistent with
// the EVM send flow's friendly errors.

// Stable error codes surfaced by the TRON send flow. Callers may switch on these
// without depending on the (translatable) human message.
export type TronErrorCode =
  | "INVALID_TRON_ADDRESS"
  | "INVALID_AMOUNT"
  | "INVALID_TRON_PAYLOAD"
  | "INSUFFICIENT_TRX_BALANCE"
  | "INSUFFICIENT_TOKEN_BALANCE"
  | "TRON_BUILD_TX_FAILED"
  | "TRON_SIGN_REJECTED"
  | "TRON_SIGN_FAILED"
  | "TRON_BROADCAST_FAILED"
  | "TRON_NETWORK_ERROR"
  | "TRON_TX_FAILED";

// A coded error. `message` stays user-facing; `code` is for programmatic checks.
export class TronError extends Error {
  readonly code: TronErrorCode;

  constructor(code: TronErrorCode, message: string) {
    super(message);
    this.name = "TronError";
    this.code = code;
  }
}

export function tronError(code: TronErrorCode, message: string): TronError {
  return new TronError(code, message);
}

// TronWeb/TronGrid sometimes hand back the failure reason as a hex string (the
// ABI-encoded revert string or a hex dump of the message). If a value is pure
// hex that decodes to printable ASCII, return the readable text; otherwise leave
// it untouched (normal messages contain spaces/punctuation and won't match).
export function decodeHexMessage(text: string): string {
  const hex = text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;

  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return text;
  }

  let decoded = "";

  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);

    // Bail out on any non-printable byte — it wasn't really a text message.
    if (code < 0x20 || code > 0x7e) {
      return text;
    }

    decoded += String.fromCharCode(code);
  }

  return decoded || text;
}

export function getRawErrorText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return decodeHexMessage(error);
  if (error instanceof Error) return error.message;

  // TronWeb frequently rejects with plain objects: { code, message } or a bare
  // string under various keys.
  const record = error as Record<string, unknown>;
  const candidate =
    record.message ?? record.error ?? record.Error ?? record.result;

  if (typeof candidate === "string") return decodeHexMessage(candidate);

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Map a low-level TRON error to a friendly, coded error. `context` lets the
// caller disambiguate which balance is short when the chain only says "balance
// is not sufficient". Already-coded TronErrors pass straight through so codes
// set deeper in the signer (build/sign/broadcast) are never re-classified.
export function normalizeTronError(
  error: unknown,
  context?: { assetSymbol?: string; isToken?: boolean },
): TronError {
  if (error instanceof TronError) {
    return error;
  }

  const raw = getRawErrorText(error);
  const text = raw.toLowerCase();
  const symbol = context?.assetSymbol ?? "TRX";

  if (
    text.includes("invalid address") ||
    text.includes("invalid recipient") ||
    text.includes("base58")
  ) {
    return tronError("INVALID_TRON_ADDRESS", "Invalid recipient address.");
  }

  // TRC-20 transfers fail for energy/bandwidth or low TRX even when the token
  // balance is fine — surface the TRX-for-fees hint first.
  if (
    text.includes("energy") ||
    text.includes("bandwidth") ||
    text.includes("feelimit") ||
    text.includes("fee limit") ||
    text.includes("out of energy")
  ) {
    return tronError(
      "INSUFFICIENT_TRX_BALANCE",
      "Not enough TRX to pay the network fee. Keep some TRX in your wallet.",
    );
  }

  if (text.includes("balance is not sufficient") || text.includes("insufficient")) {
    if (context?.isToken) {
      return tronError(
        "INSUFFICIENT_TOKEN_BALANCE",
        `Insufficient ${symbol} balance.`,
      );
    }
    return tronError(
      "INSUFFICIENT_TRX_BALANCE",
      "Insufficient TRX balance for this amount plus the network fee.",
    );
  }

  if (
    text.includes("rejected") ||
    text.includes("declined") ||
    text.includes("cancel")
  ) {
    return tronError("TRON_SIGN_REJECTED", "Transaction rejected.");
  }

  if (
    text.includes("failed to fetch") ||
    text.includes("network error") ||
    text.includes("timeout") ||
    text.includes("econn") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("rate limit") ||
    text.includes("429")
  ) {
    return tronError(
      "TRON_NETWORK_ERROR",
      "TRON network is unavailable. Try again in a moment.",
    );
  }

  if (text.includes("broadcast") || text.includes("transaction default")) {
    return tronError(
      "TRON_BROADCAST_FAILED",
      "Failed to broadcast transaction. Try again.",
    );
  }

  if (text.includes("revert") || text.includes("contract validate")) {
    return tronError("TRON_TX_FAILED", "Transaction failed on-chain.");
  }

  return tronError("TRON_TX_FAILED", raw || "TRON transaction failed.");
}
