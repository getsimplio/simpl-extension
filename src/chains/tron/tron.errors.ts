// src/chains/tron/tron.errors.ts
//
// Normalize the many shapes of TRON / TronWeb / TronGrid errors into a small set
// of user-facing messages, consistent with the EVM send flow's friendly errors.

export function getRawErrorText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  // TronWeb frequently rejects with plain objects: { code, message } or a bare
  // string under various keys.
  const record = error as Record<string, unknown>;
  const candidate =
    record.message ?? record.error ?? record.Error ?? record.result;

  if (typeof candidate === "string") return candidate;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Map a low-level TRON error to a friendly message. `context` lets the caller
// disambiguate which balance is short when the chain only says "balance is not
// sufficient".
export function normalizeTronError(
  error: unknown,
  context?: { assetSymbol?: string; isToken?: boolean },
): Error {
  const raw = getRawErrorText(error);
  const text = raw.toLowerCase();
  const symbol = context?.assetSymbol ?? "TRX";

  if (
    text.includes("invalid address") ||
    text.includes("invalid recipient") ||
    text.includes("base58")
  ) {
    return new Error("Invalid recipient address.");
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
    return new Error(
      "Not enough TRX to pay the network fee. Keep some TRX in your wallet.",
    );
  }

  if (text.includes("balance is not sufficient") || text.includes("insufficient")) {
    if (context?.isToken) {
      return new Error(`Insufficient ${symbol} balance.`);
    }
    return new Error(
      "Insufficient TRX balance for this amount plus the network fee.",
    );
  }

  if (
    text.includes("rejected") ||
    text.includes("declined") ||
    text.includes("cancel")
  ) {
    return new Error("Transaction rejected.");
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
    return new Error("TRON network is unavailable. Try again in a moment.");
  }

  if (text.includes("broadcast") || text.includes("transaction default")) {
    return new Error("Failed to broadcast transaction. Try again.");
  }

  if (text.includes("revert") || text.includes("contract validate")) {
    return new Error("Transaction failed on-chain.");
  }

  return new Error(raw || "TRON transaction failed.");
}
