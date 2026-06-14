// src/chains/solana/solana.errors.ts
//
// User-facing, coded errors for the Solana send/balance/activity flows. Each
// error carries a stable `code` (for programmatic checks) and a friendly,
// translatable `message`. We deliberately NEVER echo the raw cause for signing
// failures — it could embed sensitive material (secret key bytes).

export type SolanaErrorCode =
  | "INVALID_SOLANA_ADDRESS"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_SOL_FOR_FEE"
  | "BUILD_TX_FAILED"
  | "SIGNING_FAILED"
  | "BROADCAST_FAILED"
  | "SOLANA_NETWORK_ERROR"
  | "WATCH_ONLY"
  | "SOLANA_UNSUPPORTED_ACCOUNT"
  | "SPL_SEND_UNSUPPORTED"
  // ── Cross-chain (bridge) source-tx execution codes ──
  // The provider-built Solana transaction expired (stale blockhash) before it
  // could be signed/landed; the caller refreshes the quote once before giving up.
  | "BLOCKHASH_EXPIRED"
  // The bridge keeps returning an expired transaction even after a refresh.
  | "PROVIDER_STALE_TX"
  // The active Solana account is not a required signer of the provider's tx.
  | "WRONG_SIGNER"
  // A program invoked by the route failed during simulation (custom error).
  | "PROGRAM_ERROR"
  // The serialized transaction couldn't be read / references missing accounts.
  | "INVALID_ROUTE_TX"
  // An address-lookup-table the route depends on couldn't be resolved.
  | "ALT_LOOKUP_FAILED"
  // Simulation failed for a reason we couldn't classify more precisely.
  | "SIMULATION_FAILED"
  // ── Post-deserialization (the tx is valid; the ROUTE failed on-chain) ──
  // The provider payload could not be decoded/deserialized into a Solana tx at
  // all — the only case that is a genuine "format we can't execute".
  | "UNSUPPORTED_SOLANA_TX_FORMAT"
  // A successfully-deserialized route failed Solana simulation (generic).
  | "SOLANA_ROUTE_SIMULATION_FAILED"
  // A program invoked by the route returned a custom error during simulation.
  | "SOLANA_PROGRAM_ERROR"
  // The route references an invalid / missing / wrong-owner Solana account.
  | "SOLANA_ACCOUNT_ERROR"
  // The failing instruction belongs to the SPL Token / Associated Token program.
  | "SOLANA_TOKEN_ACCOUNT_ERROR"
  // The failing instruction belongs to the Mayan / Wormhole bridge program.
  | "SOLANA_BRIDGE_PROGRAM_ACCOUNT_ERROR"
  // ── Native SOL → wSOL pre-bridge setup tx (own phase-specific codes) ──
  | "WSOL_SETUP_SIMULATION_FAILED"
  | "WSOL_SETUP_SEND_FAILED"
  | "WSOL_SETUP_CONFIRM_FAILED"
  | "WSOL_SETUP_INSUFFICIENT_SOL"
  | "WSOL_SETUP_BLOCKHASH_EXPIRED"
  | "WSOL_SETUP_RPC_UNAVAILABLE";

export class SolanaError extends Error {
  readonly code: SolanaErrorCode;

  constructor(code: SolanaErrorCode, message: string) {
    super(message);
    this.name = "SolanaError";
    this.code = code;
  }
}

export function solanaError(
  code: SolanaErrorCode,
  message: string,
): SolanaError {
  return new SolanaError(code, message);
}

// Friendly default message per code, so callers can throw with just a code.
const DEFAULT_MESSAGES: Record<SolanaErrorCode, string> = {
  INVALID_SOLANA_ADDRESS: "Enter a valid Solana address.",
  INVALID_AMOUNT: "Enter a valid amount.",
  INSUFFICIENT_BALANCE: "Insufficient SOL balance for this amount plus the network fee.",
  INSUFFICIENT_SOL_FOR_FEE: "You need a little SOL to cover the network fee.",
  BUILD_TX_FAILED: "Could not build the transaction.",
  SIGNING_FAILED: "Could not sign the transaction.",
  BROADCAST_FAILED: "Failed to broadcast the transaction. Try again.",
  SOLANA_NETWORK_ERROR: "Solana RPC is unavailable. Try again later.",
  WATCH_ONLY: "Watch-only accounts cannot send Solana transactions.",
  SOLANA_UNSUPPORTED_ACCOUNT:
    "This account type does not support Solana. Use a recovery-phrase account.",
  SPL_SEND_UNSUPPORTED: "Sending SPL tokens is coming soon.",
  BLOCKHASH_EXPIRED: "This route expired before signing. Refresh and try again.",
  PROVIDER_STALE_TX:
    "This route keeps expiring before it can be signed. Try again in a moment.",
  WRONG_SIGNER: "This transaction requires a different Solana signer.",
  PROGRAM_ERROR: "The provider route failed on-chain simulation.",
  INVALID_ROUTE_TX: "The bridge provider returned an invalid Solana transaction.",
  ALT_LOOKUP_FAILED:
    "An address lookup table required by this route is unavailable.",
  SIMULATION_FAILED: "Solana RPC rejected the transaction during simulation.",
  UNSUPPORTED_SOLANA_TX_FORMAT:
    "The bridge provider returned a Solana transaction format Simpl cannot execute yet.",
  SOLANA_ROUTE_SIMULATION_FAILED:
    "The bridge route failed Solana simulation. Try a fresh quote, another amount, or another route.",
  SOLANA_PROGRAM_ERROR:
    "The Mayan bridge program rejected this route during simulation.",
  SOLANA_ACCOUNT_ERROR: "The bridge route references an invalid Solana account.",
  SOLANA_TOKEN_ACCOUNT_ERROR:
    "The bridge route references an invalid Solana token account.",
  SOLANA_BRIDGE_PROGRAM_ACCOUNT_ERROR:
    "The Mayan bridge program rejected one of the route accounts.",
  WSOL_SETUP_SIMULATION_FAILED: "Could not prepare the wrapped SOL account.",
  WSOL_SETUP_SEND_FAILED: "Could not send the wrapped SOL setup transaction.",
  WSOL_SETUP_CONFIRM_FAILED:
    "Wrapped SOL setup was submitted but confirmation timed out. Check the transaction before trying again.",
  WSOL_SETUP_INSUFFICIENT_SOL:
    "Not enough SOL to prepare the wrapped SOL account and pay network fees.",
  WSOL_SETUP_BLOCKHASH_EXPIRED:
    "The wrapped SOL setup expired before it landed. Try again.",
  WSOL_SETUP_RPC_UNAVAILABLE:
    "Solana RPC is temporarily unavailable. Please try again.",
};

export function solanaErrorFor(
  code: SolanaErrorCode,
  message?: string,
): SolanaError {
  return new SolanaError(code, message ?? DEFAULT_MESSAGES[code]);
}

// Map an arbitrary low-level error to a friendly, coded error. Already-coded
// SolanaErrors pass straight through so a precise code set deeper in the
// build/sign/broadcast path is never re-classified. We only inspect the message
// text — never the structured cause — to avoid leaking signing material.
export function normalizeSolanaError(
  error: unknown,
  fallback: SolanaErrorCode = "SOLANA_NETWORK_ERROR",
): SolanaError {
  if (error instanceof SolanaError) {
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
    text.includes("access forbidden") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  ) {
    return solanaErrorFor("SOLANA_NETWORK_ERROR");
  }

  return solanaErrorFor(fallback);
}
