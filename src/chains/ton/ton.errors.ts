// src/chains/ton/ton.errors.ts
//
// User-facing, coded errors for the TON balance / address / send flows. Each
// error carries a stable `code` (for programmatic checks) and a friendly,
// translatable `message`. We deliberately NEVER echo the raw cause for signing
// failures — it could embed sensitive material.

export type TonErrorCode =
  | "TON_INVALID_ADDRESS"
  | "TON_INVALID_AMOUNT"
  | "TON_PROVIDER_UNAVAILABLE"
  | "TON_BALANCE_FETCH_FAILED"
  | "TON_JETTON_FETCH_FAILED"
  | "TON_WALLET_UNINIT"
  | "TON_WALLET_NOT_ACTIVE"
  | "TON_PRICE_UNAVAILABLE"
  | "TON_UNSUPPORTED_ACCOUNT"
  // Sending TON is not wired in this MVP (receive-only). Architectural backstop
  // so a stray send path surfaces a clean coded error instead of misrouting.
  | "TON_SEND_UNSUPPORTED";

export class TonError extends Error {
  readonly code: TonErrorCode;

  constructor(code: TonErrorCode, message: string) {
    super(message);
    this.name = "TonError";
    this.code = code;
  }
}

// Friendly default message per code, so callers can throw with just a code.
const DEFAULT_MESSAGES: Record<TonErrorCode, string> = {
  TON_INVALID_ADDRESS: "Enter a valid TON address.",
  TON_INVALID_AMOUNT: "Enter a valid amount.",
  TON_PROVIDER_UNAVAILABLE: "TON network is unavailable. Try again later.",
  TON_BALANCE_FETCH_FAILED: "Couldn't load your TON balance. Try again.",
  TON_JETTON_FETCH_FAILED: "Couldn't load your TON tokens. Try again.",
  TON_WALLET_UNINIT:
    "This TON wallet isn't deployed yet — it activates on its first send. Receiving still works.",
  TON_WALLET_NOT_ACTIVE: "This TON wallet is not active.",
  TON_PRICE_UNAVAILABLE: "TON price is unavailable right now.",
  TON_UNSUPPORTED_ACCOUNT:
    "This account type does not support TON. Use a recovery-phrase account.",
  TON_SEND_UNSUPPORTED: "Sending TON is not available yet.",
};

export function tonErrorFor(code: TonErrorCode, message?: string): TonError {
  return new TonError(code, message ?? DEFAULT_MESSAGES[code]);
}

// Map an arbitrary low-level error to a friendly, coded error. Already-coded
// TonErrors pass straight through so a precise code set deeper in the path is
// never re-classified. We only inspect the message text — never a structured
// cause — to avoid leaking any sensitive material.
export function normalizeTonError(
  error: unknown,
  fallback: TonErrorCode = "TON_PROVIDER_UNAVAILABLE",
): TonError {
  if (error instanceof TonError) {
    return error;
  }

  const text = (error instanceof Error ? error.message : String(error ?? ""))
    .toLowerCase();

  if (
    text.includes("failed to fetch") ||
    text.includes("network error") ||
    text.includes("timeout") ||
    text.includes("econn") ||
    text.includes("403") ||
    text.includes("forbidden") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  ) {
    return tonErrorFor("TON_PROVIDER_UNAVAILABLE");
  }

  return tonErrorFor(fallback);
}
