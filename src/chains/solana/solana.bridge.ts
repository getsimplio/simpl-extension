// src/chains/solana/solana.bridge.ts
//
// Cross-chain (LI.FI / Mayan) Solana SOURCE transaction execution. The provider
// returns a serialized, ready-to-sign Solana transaction (base64). This module
// owns the full execute pipeline so the failure mode is always classified, never
// flattened into a single "broadcast failed":
//
//   deserialize → diagnose → validate blockhash → sign → simulate → broadcast
//
// It is intentionally SEPARATE from the same-chain Jupiter swap signer
// (solana.swap.ts), which signs locally and broadcasts server-side. Here we sign
// AND broadcast on a Solana RPC, because the bridge gateway has no Solana execute
// endpoint.
//
// SECURITY: the secret key only constructs an in-memory Keypair and never leaves
// this module — never logged, returned or persisted. Dev diagnostics log the
// public key, blockhash, tx shape and simulation error CATEGORY + logs only;
// never the raw serialized tx, the signatures array, the secret key or the seed.

import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { base58 } from "@scure/base";
import {
  resolveHealthySolanaConnection,
} from "./solana.rpc";
import { SOLANA_MAINNET, type SolanaChainConfig } from "./solana.config";
import {
  solanaErrorFor,
  SolanaError,
  type SolanaErrorCode,
} from "./solana.errors";

// localStorage key that turns bridge diagnostics on at RUNTIME in a built /
// unpacked extension (compile-time import.meta.env.DEV is false there).
const BRIDGE_DEBUG_FLAG_KEY = "simpl.debug.bridge";

// Single source of truth for whether bridge diagnostics are enabled. On in dev
// builds, when VITE_BRIDGE_DEBUG="true", OR at runtime via:
//   localStorage.setItem("simpl.debug.bridge", "1"); location.reload();
// Re-read on every call so it works the moment the flag is set + reloaded.
// Silent by default for production users. localStorage is guarded because the
// background service worker has no localStorage.
export function isBridgeDebugEnabled(): boolean {
  if (Boolean((import.meta.env as { DEV?: boolean } | undefined)?.DEV)) {
    return true;
  }
  if (
    (import.meta.env as { VITE_BRIDGE_DEBUG?: string } | undefined)
      ?.VITE_BRIDGE_DEBUG === "true"
  ) {
    return true;
  }
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(BRIDGE_DEBUG_FLAG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

// Structured diagnostics, prefixed [bridge:solana]. Privacy-safe by construction
// — callers must never pass secret material, signatures, or the raw serialized
// transaction. console.info/warn (NOT console.debug, which Chrome hides).
function log(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[bridge:solana] ${event}`, data);
}

function warn(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.warn(`[bridge:solana] ${event}`, data);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Provider transaction extraction & normalization ─────────────────────────
//
// LI.FI / Mayan can return the Solana source transaction in several fields and
// encodings depending on the tool. We probe a prioritized set of fields, decode
// each (standard base64, base64url, or a byte array / JSON Buffer), and accept
// the FIRST one that actually deserializes into a Solana transaction. The result
// is re-serialized to canonical standard base64 so the rest of the pipeline has
// a single, known-good representation.

// Candidate fields that may carry the serialized Solana tx, most-specific first.
const SOLANA_TX_FIELDS = [
  "serializedTransaction",
  "data",
  "rawTransaction",
  "transaction",
  "tx",
  "swapTransaction",
] as const;

// Safe, value-free summary of the provider payload shape — for dev diagnostics.
export type SolanaTxShapeSummary = {
  payloadType: string;
  // Top-level key NAMES only (never values).
  keys: string[];
  candidateField: string | null;
  stringLength: number | null;
  decodedByteLength: number | null;
  firstByte: number | null;
  deserError: string | null;
};

type Encoding = "base64" | "base64url" | "base58" | "array";

export type SolanaTxExtraction =
  | {
      ok: true;
      // Canonical standard-base64 serialized transaction.
      serializedBase64: string;
      sourceField: string;
      byteLength: number;
      encoding: Encoding;
      format: "versioned" | "legacy";
    }
  | {
      ok: false;
      code: "INVALID_ROUTE_TX";
      reason: string;
      shapeSummary: SolanaTxShapeSummary;
    };

// Strip ALL whitespace/newlines a provider may have wrapped the payload in.
function stripWhitespace(value: string): string {
  return value.replace(/\s+/gu, "");
}

function decodeBase64Std(value: string): Uint8Array | null {
  try {
    return base64ToBytes(value);
  } catch {
    return null;
  }
}

// base64url → standard base64 (+ padding), then decode.
function decodeBase64Url(value: string): Uint8Array | null {
  const std = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  return decodeBase64Std(padded);
}

function decodeBase58(value: string): Uint8Array | null {
  try {
    return base58.decode(value);
  } catch {
    return null;
  }
}

function decodeWith(encoding: Encoding, value: string): Uint8Array | null {
  if (encoding === "base64") return decodeBase64Std(value);
  if (encoding === "base64url") return decodeBase64Url(value);
  if (encoding === "base58") return decodeBase58(value);
  return null;
}

// Encodings to try, ordered by the provider's `format` hint. CRITICAL: a hint
// like "solana" / "svm" / "mayan" is a provider TRANSACTION-FORMAT label, NOT an
// encoding — so we must not treat it as one. We only honor explicit base64 /
// base64url hints; everything else (base58, provider labels, unknown, absent)
// tries BASE58 FIRST, because Mayan/LI.FI Solana payloads are typically base58.
// We always keep the other encodings as fallbacks and NEVER trust a successful
// decode — only a successful DESERIALIZE — so a base58 string that decodes
// "fine" as base64 (its chars are a base64 subset) can't be mistaken for a tx.
function encodingOrder(formatHint: string | null): Encoding[] {
  const f = (formatHint ?? "").toLowerCase();
  if (f.includes("base64url") || f.includes("b64url")) {
    return ["base64url", "base64", "base58"];
  }
  if (f.includes("base64") || f.includes("b64")) {
    return ["base64", "base64url", "base58"];
  }
  // "base58"/"b58"/"bs58", provider labels ("solana"/"svm"/"mayan"/…), hex,
  // unknown, or no hint → base58 first. (A base64 payload still resolves: base58
  // decode of base64-only chars like +/= throws, so it falls through to base64;
  // hex simply won't deserialize and falls through to the unsupported path.)
  return ["base58", "base64", "base64url"];
}

// Convert an array-like value to bytes: a number[], a Uint8Array, or a
// JSON-serialized Node Buffer ({ type: "Buffer", data: number[] }).
function arrayLikeToBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) {
    return Uint8Array.from(value as number[]);
  }
  if (value && typeof value === "object") {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data) && data.every((n) => typeof n === "number")) {
      return Uint8Array.from(data as number[]);
    }
  }
  return null;
}

type DeserResult =
  | { ok: true; canonical: Uint8Array; format: "versioned" | "legacy" }
  | { ok: false; error: string };

function tryVersioned(bytes: Uint8Array): DeserResult {
  try {
    const vtx = VersionedTransaction.deserialize(bytes);
    return {
      ok: true,
      canonical: vtx.serialize(),
      format: vtx.message.version === "legacy" ? "legacy" : "versioned",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "error" };
  }
}

function tryLegacy(bytes: Uint8Array): DeserResult {
  try {
    const legacy = Transaction.from(bytes);
    return {
      ok: true,
      canonical: legacy.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
      format: "legacy",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "error" };
  }
}

// Deserialize canonical bytes for the executor (VersionedTransaction handles v0
// AND legacy; legacy Transaction.from is the fallback). Throws with both error
// messages on total failure.
function deserializeToVersioned(bytes: Uint8Array): {
  tx: VersionedTransaction;
  format: "versioned" | "legacy";
} {
  try {
    const vtx = VersionedTransaction.deserialize(bytes);
    return {
      tx: vtx,
      format: vtx.message.version === "legacy" ? "legacy" : "versioned",
    };
  } catch (versionedError) {
    try {
      const legacy = Transaction.from(bytes);
      const canonical = legacy.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const vtx = VersionedTransaction.deserialize(canonical);
      return { tx: vtx, format: "legacy" };
    } catch (legacyError) {
      const vName =
        versionedError instanceof Error ? versionedError.message : "versioned";
      const lName =
        legacyError instanceof Error ? legacyError.message : "legacy";
      throw new Error(`versioned: ${vName} | legacy: ${lName}`);
    }
  }
}

function collectCandidates(
  source: unknown,
): { candidates: Array<{ field: string; value: unknown }>; formatHint: string | null } {
  if (
    typeof source === "string" ||
    Array.isArray(source) ||
    source instanceof Uint8Array
  ) {
    return {
      candidates: [{ field: "transactionRequest", value: source }],
      formatHint: null,
    };
  }
  if (source && typeof source === "object") {
    const obj = source as Record<string, unknown>;
    const formatHint = typeof obj.format === "string" ? obj.format : null;
    return {
      candidates: SOLANA_TX_FIELDS.filter((f) => f in obj).map((f) => ({
        field: f,
        value: obj[f],
      })),
      formatHint,
    };
  }
  return { candidates: [], formatHint: null };
}

// THE single extraction entry point. Tries each candidate field, decoding by the
// provider `format` hint (with full fallbacks), and accepts the FIRST payload
// that DESERIALIZES — not merely decodes. Emits safe [bridge:solana] tx-candidate
// diagnostics per attempt. Returns canonical base64 + field/encoding/format, or a
// safe shape summary explaining why none worked.
export function extractSerializedSolanaTransaction(
  source: unknown,
): SolanaTxExtraction {
  const { candidates, formatHint } = collectCandidates(source);
  const order = encodingOrder(formatHint);
  let firstDecoded: { field: string; len: number; firstByte: number | null } | null =
    null;
  let lastDeserError: string | null = null;

  for (const candidate of candidates) {
    // Array / Buffer payloads decode directly (no string encoding involved).
    if (typeof candidate.value !== "string") {
      const bytes = arrayLikeToBytes(candidate.value);
      if (!bytes || bytes.length < 64) continue;
      if (!firstDecoded) {
        firstDecoded = {
          field: candidate.field,
          len: bytes.length,
          firstByte: bytes[0] ?? null,
        };
      }
      const versioned = tryVersioned(bytes);
      const legacy = versioned.ok ? null : tryLegacy(bytes);
      log("tx-candidate", {
        sourceField: candidate.field,
        format: formatHint,
        payloadType: "array",
        stringLength: null,
        encodingTried: "array",
        decodedByteLength: bytes.length,
        firstByte: bytes[0] ?? null,
        versionedDeserialize: versioned.ok ? "success" : versioned.error,
        legacyDeserialize: legacy ? (legacy.ok ? "success" : legacy.error) : "skipped",
      });
      const win = versioned.ok ? versioned : legacy?.ok ? legacy : null;
      if (win) {
        return {
          ok: true,
          serializedBase64: bytesToBase64(win.canonical),
          sourceField: candidate.field,
          byteLength: win.canonical.length,
          encoding: "array",
          format: win.format,
        };
      }
      lastDeserError =
        legacy && !legacy.ok
          ? legacy.error
          : !versioned.ok
            ? versioned.error
            : lastDeserError;
      continue;
    }

    const raw = stripWhitespace(candidate.value);
    if (raw.length === 0) continue;
    if (/^0x[0-9a-fA-F]+$/u.test(raw)) continue; // EVM-style hex — not Solana.

    for (const encoding of order) {
      const bytes = decodeWith(encoding, raw);
      if (!bytes || bytes.length < 64) {
        log("tx-candidate", {
          sourceField: candidate.field,
          format: formatHint,
          payloadType: "string",
          stringLength: raw.length,
          encodingTried: encoding,
          decodedByteLength: bytes?.length ?? null,
          firstByte: bytes?.[0] ?? null,
          versionedDeserialize: "skipped (decode failed/too short)",
          legacyDeserialize: "skipped",
        });
        continue;
      }
      if (!firstDecoded) {
        firstDecoded = {
          field: candidate.field,
          len: bytes.length,
          firstByte: bytes[0] ?? null,
        };
      }
      const versioned = tryVersioned(bytes);
      const legacy = versioned.ok ? null : tryLegacy(bytes);
      log("tx-candidate", {
        sourceField: candidate.field,
        format: formatHint,
        payloadType: "string",
        stringLength: raw.length,
        encodingTried: encoding,
        decodedByteLength: bytes.length,
        firstByte: bytes[0] ?? null,
        versionedDeserialize: versioned.ok ? "success" : versioned.error,
        legacyDeserialize: legacy ? (legacy.ok ? "success" : legacy.error) : "skipped",
      });
      const win = versioned.ok ? versioned : legacy?.ok ? legacy : null;
      if (win) {
        log("solana:tx-extracted", {
          sourceField: candidate.field,
          encoding,
          byteLength: win.canonical.length,
          format: win.format,
        });
        return {
          ok: true,
          serializedBase64: bytesToBase64(win.canonical),
          sourceField: candidate.field,
          byteLength: win.canonical.length,
          encoding,
          format: win.format,
        };
      }
      lastDeserError =
        legacy && !legacy.ok
          ? legacy.error
          : !versioned.ok
            ? versioned.error
            : lastDeserError;
    }
  }

  const firstString = candidates.find((c) => typeof c.value === "string");
  const shapeSummary: SolanaTxShapeSummary = {
    payloadType:
      source == null
        ? "null"
        : Array.isArray(source)
          ? "array"
          : typeof source,
    keys:
      source && typeof source === "object" && !Array.isArray(source)
        ? Object.keys(source as object)
        : [],
    candidateField: firstDecoded?.field ?? candidates[0]?.field ?? null,
    stringLength:
      firstString && typeof firstString.value === "string"
        ? stripWhitespace(firstString.value).length
        : null,
    decodedByteLength: firstDecoded?.len ?? null,
    firstByte: firstDecoded?.firstByte ?? null,
    deserError: lastDeserError,
  };
  return {
    ok: false,
    code: "INVALID_ROUTE_TX",
    reason: "Provider returned no valid Solana transaction payload.",
    shapeSummary,
  };
}

// Dev-only [bridge:solana] invalid-tx diagnostic. Logs the source field, the
// transactionRequest key NAMES (never values), payload type, string length,
// decoded byte length, first decoded byte and the deserialization error — never
// the serialized tx, signatures, key material or seed.
export function logSolanaInvalidTx(
  summary: SolanaTxShapeSummary,
  where: string,
): void {
  warn("invalid-tx", { where, ...summary });
}

// Dev-only [bridge:solana] invariant-invalid-after-gating diagnostic. Emitted
// when execution rejects a Solana tx the quote gating had marked executable —
// i.e. the two paths disagreed. Safe metadata only (no tx / signatures / keys).
export function logSolanaInvariantAfterGating(data: {
  sourceField: string | null;
  byteLength: number | null;
  format: string | null;
  executionStatus: string;
  code: string;
}): void {
  warn("invariant-invalid-after-gating", data);
}

// Privacy-safe shape of the provider transaction, computed before signing.
export type SolanaBridgeTxDiagnostics = {
  format: "versioned" | "legacy";
  byteLength: number;
  recentBlockhash: string | null;
  // The fee payer is the first required signer (account index 0).
  feePayer: string | null;
  numRequiredSignatures: number;
  signatureCount: number;
  emptySignatureCount: number;
  usesAddressLookupTables: boolean;
  // Whether the active wallet appears in the required-signer set.
  walletIsRequiredSigner: boolean;
};

function isAllZero(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

// Deserialize the provider payload as a VersionedTransaction (web3.js handles
// BOTH v0 and legacy messages through this path) and compute privacy-safe
// diagnostics relative to the active wallet.
function inspect(
  transactionBase64: string,
  walletPubkey: PublicKey,
): { tx: VersionedTransaction; diag: SolanaBridgeTxDiagnostics } {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(transactionBase64);
  } catch {
    logSolanaInvalidTx(
      {
        payloadType: "string",
        keys: [],
        candidateField: "serializedBase64",
        stringLength: transactionBase64.length,
        decodedByteLength: null,
        firstByte: null,
        deserError: "base64 decode failed",
      },
      "execute",
    );
    throw solanaErrorFor("UNSUPPORTED_SOLANA_TX_FORMAT");
  }
  if (bytes.length < 64) {
    logSolanaInvalidTx(
      {
        payloadType: "string",
        keys: [],
        candidateField: "serializedBase64",
        stringLength: transactionBase64.length,
        decodedByteLength: bytes.length,
        firstByte: bytes[0] ?? null,
        deserError: "decoded payload too short",
      },
      "execute",
    );
    throw solanaErrorFor("UNSUPPORTED_SOLANA_TX_FORMAT");
  }

  let tx: VersionedTransaction;
  try {
    tx = deserializeToVersioned(bytes).tx;
  } catch (error) {
    logSolanaInvalidTx(
      {
        payloadType: "string",
        keys: [],
        candidateField: "serializedBase64",
        stringLength: transactionBase64.length,
        decodedByteLength: bytes.length,
        firstByte: bytes[0] ?? null,
        deserError: error instanceof Error ? error.message : String(error),
      },
      "execute",
    );
    throw solanaErrorFor("UNSUPPORTED_SOLANA_TX_FORMAT");
  }

  const message = tx.message;
  const numRequiredSignatures = message.header.numRequiredSignatures;
  const staticKeys = message.staticAccountKeys;
  const signerKeys = staticKeys.slice(0, numRequiredSignatures);
  const walletIsRequiredSigner = signerKeys.some((k) => k.equals(walletPubkey));
  const emptySignatureCount = tx.signatures.filter(isAllZero).length;
  const lookups =
    message.version === "legacy" ? [] : message.addressTableLookups ?? [];

  const diag: SolanaBridgeTxDiagnostics = {
    format: message.version === "legacy" ? "legacy" : "versioned",
    byteLength: bytes.length,
    recentBlockhash: message.recentBlockhash ?? null,
    feePayer: staticKeys[0]?.toBase58() ?? null,
    numRequiredSignatures,
    signatureCount: tx.signatures.length,
    emptySignatureCount,
    usesAddressLookupTables: lookups.length > 0,
    walletIsRequiredSigner,
  };
  return { tx, diag };
}

// ── Instruction-level failure diagnosis ─────────────────────────────────────

// Well-known program ids → a human label + family for classification refinement.
// SPL/ATA/System/ComputeBudget are canonical and certain; the Mayan/Wormhole ids
// are best-effort (an unrecognized id just labels "Unknown" — never harmful).
type ProgramFamily = "compute" | "system" | "token" | "ata" | "bridge" | "unknown";

const KNOWN_PROGRAMS: Record<string, { label: string; family: ProgramFamily }> = {
  ComputeBudget111111111111111111111111111111: {
    label: "ComputeBudget",
    family: "compute",
  },
  "11111111111111111111111111111111": { label: "System", family: "system" },
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: {
    label: "SPL Token",
    family: "token",
  },
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: {
    label: "SPL Token-2022",
    family: "token",
  },
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: {
    label: "Associated Token",
    family: "ata",
  },
  // Mayan / Wormhole (best-effort — used only to refine the error message).
  worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth: {
    label: "Wormhole Core",
    family: "bridge",
  },
  wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb: {
    label: "Wormhole Token Bridge",
    family: "bridge",
  },
  BLZRi6frs4X4DNLw56V4EXai1b6QVESN1BhHBTYM9VcY: {
    label: "Mayan Swift",
    family: "bridge",
  },
  FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfLn6vsf: {
    label: "Mayan",
    family: "bridge",
  },
};

function labelProgram(programId: string | null): { label: string; family: ProgramFamily } {
  if (!programId) return { label: "unknown", family: "unknown" };
  return KNOWN_PROGRAMS[programId] ?? { label: "unknown", family: "unknown" };
}

export type SolanaInstructionFailure = {
  instructionIndex: number;
  reason: string;
  programId: string | null;
  programLabel: string;
  programFamily: ProgramFamily;
  accountCount: number;
  // Resolved public-key strings when ALTs resolve; otherwise "idx:<n>" markers.
  accounts: string[];
  // Diagnostics fallback when account keys can't be fully resolved.
  programIdIndex: number;
  accountKeyIndexes: number[];
  staticAccountKeyCount: number;
  resolvedAccountKeys: boolean;
};

// Parse a `{ InstructionError: [index, reason] }` err. Returns null otherwise.
function parseInstructionError(
  err: unknown,
): { index: number; reason: string } | null {
  if (!err || typeof err !== "object") return null;
  const ie = (err as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(ie) || ie.length < 2 || typeof ie[0] !== "number") {
    return null;
  }
  const reason =
    typeof ie[1] === "string"
      ? ie[1]
      : (() => {
          try {
            return JSON.stringify(ie[1]);
          } catch {
            return String(ie[1]);
          }
        })();
  return { index: ie[0], reason };
}

// Resolve which instruction/program/accounts failed. Best-effort ALT resolution
// (fetches the route's lookup tables to fully resolve account keys); degrades to
// indexes + static keys if that isn't possible. NEVER throws — diagnostics must
// not break the failure path.
type InstructionDiagnosis = {
  info: SolanaInstructionFailure;
  // Resolved account pubkeys for the failing instruction (for account inspection).
  pubkeys: (PublicKey | null)[];
  // First byte of the instruction data (SPL Token instruction discriminator).
  discriminator: number | null;
};

async function diagnoseInstructionFailure(params: {
  connection: Connection;
  tx: VersionedTransaction;
  err: unknown;
  diag: SolanaBridgeTxDiagnostics;
}): Promise<InstructionDiagnosis | null> {
  const parsed = parseInstructionError(params.err);
  if (!parsed) return null;

  const message = params.tx.message;
  const compiled = message.compiledInstructions;
  const cin = compiled[parsed.index];
  const staticAccountKeyCount = message.staticAccountKeys.length;

  // Try to fully resolve account keys (incl. ALTs) so we can name the program.
  let accountKeys: { get(i: number): PublicKey | undefined } | null = null;
  let resolvedAccountKeys = false;
  try {
    if (message.version === "legacy") {
      accountKeys = message.getAccountKeys();
      resolvedAccountKeys = true;
    } else {
      const lookups = message.addressTableLookups ?? [];
      const altAccounts = [];
      for (const lookup of lookups) {
        const res = await params.connection.getAddressLookupTable(
          lookup.accountKey,
        );
        if (res.value) altAccounts.push(res.value);
      }
      accountKeys = message.getAccountKeys({
        addressLookupTableAccounts: altAccounts,
      });
      resolvedAccountKeys = true;
    }
  } catch {
    // Partial/failed ALT resolution — fall back to static keys + raw indexes.
    accountKeys = null;
    resolvedAccountKeys = false;
  }

  function keyObjAt(index: number): PublicKey | null {
    return accountKeys?.get(index) ?? message.staticAccountKeys[index] ?? null;
  }
  function keyAt(index: number): string {
    return keyObjAt(index)?.toBase58() ?? `idx:${index}`;
  }

  const programIdIndex = cin?.programIdIndex ?? -1;
  const programId = cin ? keyAt(programIdIndex) : null;
  const isRealProgramId = programId != null && !programId.startsWith("idx:");
  const { label, family } = labelProgram(isRealProgramId ? programId : null);
  const accountKeyIndexes = cin ? cin.accountKeyIndexes : [];
  const cappedIndexes = accountKeyIndexes.slice(0, 32);
  // Cap the logged account list — they are public keys, but keep it tidy.
  const accounts = cappedIndexes.map((i) => keyAt(i));
  const pubkeys = cappedIndexes.map((i) => keyObjAt(i));
  const discriminator =
    cin && cin.data.length > 0 ? cin.data[0] ?? null : null;

  return {
    info: {
      instructionIndex: parsed.index,
      reason: parsed.reason,
      programId: isRealProgramId ? programId : null,
      programLabel: label,
      programFamily: family,
      accountCount: accountKeyIndexes.length,
      accounts,
      programIdIndex,
      accountKeyIndexes,
      staticAccountKeyCount,
      resolvedAccountKeys,
    },
    pubkeys,
    discriminator,
  };
}

// Refine a base SOLANA_ACCOUNT_ERROR using the failing program's family — token
// vs bridge vs generic. Only refines account errors; other codes pass through.
function refineAccountErrorCode(
  baseCode: SolanaErrorCode,
  family: ProgramFamily,
): SolanaErrorCode {
  if (baseCode !== "SOLANA_ACCOUNT_ERROR") return baseCode;
  if (family === "token" || family === "ata") return "SOLANA_TOKEN_ACCOUNT_ERROR";
  if (family === "bridge") return "SOLANA_BRIDGE_PROGRAM_ACCOUNT_ERROR";
  return baseCode;
}

// ── SPL Token instruction / account diagnostics ─────────────────────────────

const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_ACCOUNT_LEN = 165;
const SPL_MINT_LEN = 82;

// SPL Token instruction discriminator (first data byte) → name.
const SPL_TOKEN_INSTRUCTION_NAMES: Record<number, string> = {
  0: "InitializeMint",
  1: "InitializeAccount",
  2: "InitializeMultisig",
  3: "Transfer",
  4: "Approve",
  5: "Revoke",
  6: "SetAuthority",
  7: "MintTo",
  8: "Burn",
  9: "CloseAccount",
  10: "FreezeAccount",
  11: "ThawAccount",
  12: "TransferChecked",
  13: "ApproveChecked",
  14: "MintToChecked",
  15: "BurnChecked",
  16: "InitializeAccount2",
  17: "SyncNative",
  18: "InitializeAccount3",
  19: "InitializeMultisig2",
  20: "InitializeMint2",
  21: "GetAccountDataSize",
  22: "InitializeImmutableOwner",
  23: "AmountToUiAmount",
  24: "UiAmountToAmount",
  25: "InitializeMintCloseAuthority",
  26: "TransferFeeExtension",
};

function splTokenInstructionName(discriminator: number | null): string {
  if (discriminator == null) return "unknown";
  return SPL_TOKEN_INSTRUCTION_NAMES[discriminator] ?? `Unknown(${discriminator})`;
}

export type TokenAccountDiagnostic = {
  pubkey: string;
  exists: boolean;
  owner: string | null;
  lamports: number | null;
  dataLength: number | null;
  executable: boolean | null;
  // Decoded SPL token-account fields (only when owned by a token program and the
  // data is token-account-sized). Never the raw account bytes.
  tokenMint?: string | null;
  tokenOwner?: string | null;
  tokenState?: "uninitialized" | "initialized" | "frozen" | "unknown" | null;
  isWrappedSol?: boolean;
  issue?: string | null;
};

// Decode the safe header fields of an SPL token account (mint/owner/state) WITHOUT
// logging raw bytes. Layout: mint[0..32], owner[32..64], state byte at offset 108.
function decodeTokenAccountHeader(
  data: Uint8Array,
): { mint: string; owner: string; state: TokenAccountDiagnostic["tokenState"] } | null {
  if (data.length < SPL_TOKEN_ACCOUNT_LEN) return null;
  try {
    const mint = new PublicKey(data.subarray(0, 32)).toBase58();
    const owner = new PublicKey(data.subarray(32, 64)).toBase58();
    const stateByte = data[108];
    const state =
      stateByte === 0
        ? "uninitialized"
        : stateByte === 1
          ? "initialized"
          : stateByte === 2
            ? "frozen"
            : "unknown";
    return { mint, owner, state };
  } catch {
    return null;
  }
}

// Fetch + classify the accounts touched by the failing SPL Token instruction.
// NEVER throws (returns nulls on RPC failure) and never logs raw account data.
async function inspectTokenAccounts(
  connection: Connection,
  pubkeys: (PublicKey | null)[],
): Promise<{ accounts: TokenAccountDiagnostic[]; likelyCause: string | null }> {
  const real = pubkeys.filter((p): p is PublicKey => p != null);
  if (real.length === 0) return { accounts: [], likelyCause: null };

  const infos = await connection.getMultipleAccountsInfo(real);
  const accounts: TokenAccountDiagnostic[] = real.map((pk, i) => {
    const info = infos[i];
    const pubkey = pk.toBase58();
    if (!info) {
      return {
        pubkey,
        exists: false,
        owner: null,
        lamports: null,
        dataLength: null,
        executable: null,
        issue: "account missing / uninitialized",
      };
    }
    const owner = info.owner.toBase58();
    const data = info.data as Uint8Array;
    const diag: TokenAccountDiagnostic = {
      pubkey,
      exists: true,
      owner,
      lamports: info.lamports,
      dataLength: data.length,
      executable: info.executable,
    };
    const isTokenProgram =
      owner === SPL_TOKEN_PROGRAM_ID || owner === TOKEN_2022_PROGRAM_ID;
    if (isTokenProgram && data.length >= SPL_TOKEN_ACCOUNT_LEN) {
      const decoded = decodeTokenAccountHeader(data);
      if (decoded) {
        diag.tokenMint = decoded.mint;
        diag.tokenOwner = decoded.owner;
        diag.tokenState = decoded.state;
        diag.isWrappedSol = decoded.mint === WSOL_MINT;
        if (decoded.state === "uninitialized") {
          diag.issue = "token account uninitialized";
        }
      }
    } else if (owner === SYSTEM_PROGRAM_ID) {
      // A system-owned account used where the program expects a token account is
      // the classic InvalidAccountData cause (an ATA/wSOL account never created).
      diag.issue =
        data.length === 0
          ? "owned by System Program (uninitialized token account / ATA not created)"
          : "owned by System Program, not a token program";
    } else if (!isTokenProgram && !info.executable) {
      diag.issue = "owned by an unexpected program";
    } else if (isTokenProgram && data.length === SPL_MINT_LEN) {
      // a mint account — fine where a mint is expected; noted for context.
      diag.issue = null;
    } else if (isTokenProgram && data.length < SPL_TOKEN_ACCOUNT_LEN) {
      diag.issue = "token-program account with unexpected data length";
    }
    return diag;
  });

  // Pick the most likely culprit for InvalidAccountData: first missing account,
  // then a system-owned account where a token account was expected, then an
  // uninitialized token account.
  const missing = accounts.find((a) => !a.exists);
  const systemOwned = accounts.find(
    (a) => a.exists && a.owner === SYSTEM_PROGRAM_ID,
  );
  const uninit = accounts.find((a) => a.tokenState === "uninitialized");
  const wsol = accounts.find((a) => a.isWrappedSol);
  let likelyCause: string | null = null;
  if (missing) {
    likelyCause = `account missing: ${missing.pubkey}`;
  } else if (systemOwned) {
    likelyCause = `account owned by System Program (token account / ATA not created): ${systemOwned.pubkey}`;
  } else if (uninit) {
    likelyCause = `token account uninitialized: ${uninit.pubkey}`;
  }
  if (wsol && likelyCause) {
    likelyCause = `${likelyCause} (wSOL involved)`;
  }
  return { accounts, likelyCause };
}

// ── Native SOL → wSOL pre-bridge setup ──────────────────────────────────────
//
// Some Mayan/LI.FI Solana-source routes assume the user already holds a funded
// wrapped-SOL (wSOL) associated token account and run TransferChecked against
// it. When the user pays NATIVE SOL, that ATA may not exist → the route fails
// simulation with SPL Token InvalidAccountData. We NEVER mutate the provider
// transaction; instead we detect this precise case and send a SEPARATE, standard
// setup tx (idempotent ATA create + lamport transfer + SyncNative) first, then
// refresh + execute the bridge.

// The active wallet's canonical wSOL associated token account.
function wsolAtaFor(walletPubkey: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(NATIVE_MINT, walletPubkey);
}

// Read the wrapped-SOL token amount (u64 LE at offset 64) from token-account
// data. Returns 0n when the account isn't a readable token account.
function readTokenAmount(data: Uint8Array): bigint {
  if (data.length < SPL_TOKEN_ACCOUNT_LEN) return 0n;
  let amount = 0n;
  for (let i = 0; i < 8; i += 1) {
    amount |= BigInt(data[64 + i] ?? 0) << BigInt(8 * i);
  }
  return amount;
}

// Resolve the message's full account-key set (incl. ALTs). Returns null if the
// lookup tables can't be resolved. Best-effort; never throws.
async function resolveMessageAccountKeys(
  connection: Connection,
  tx: VersionedTransaction,
): Promise<{ get(i: number): PublicKey | undefined; has(pk: PublicKey): boolean } | null> {
  const message = tx.message;
  try {
    let keys;
    if (message.version === "legacy") {
      keys = message.getAccountKeys();
    } else {
      const altAccounts = [];
      for (const lookup of message.addressTableLookups ?? []) {
        const res = await connection.getAddressLookupTable(lookup.accountKey);
        if (res.value) altAccounts.push(res.value);
      }
      keys = message.getAccountKeys({ addressLookupTableAccounts: altAccounts });
    }
    const flat = keys.keySegments().flat();
    return {
      get: (i) => keys.get(i),
      has: (pk) => flat.some((k) => k.equals(pk)),
    };
  } catch {
    return null;
  }
}

export type WsolSetupNeed = {
  needed: boolean;
  // Whether the route's tx actually references this wSOL ATA.
  referenced: boolean;
  wsolAta: string;
  exists: boolean;
  currentWrappedAmount: string;
  // Lamports to transfer into the ATA so it holds at least fromAmount of wSOL.
  lamportsToWrap: string;
  // Rent the payer funds if the ATA must be created (0 when it already exists).
  rentLamports: string;
  reason: string;
};

// Detect whether a native-SOL Solana-source route needs a wSOL ATA prepared for
// the active wallet BEFORE the bridge tx can succeed. Read-only (no secret key).
// Returns needed=false unless the route's tx references THIS wallet's wSOL ATA
// and it's missing/underfunded — we never guess for any other account.
export async function detectWsolSetupNeed(params: {
  transactionBase64: string;
  walletAddress: string;
  fromAmountLamports: string;
  config?: SolanaChainConfig;
}): Promise<WsolSetupNeed> {
  const config = params.config ?? SOLANA_MAINNET;
  const walletPubkey = new PublicKey(params.walletAddress);
  const wsolAta = wsolAtaFor(walletPubkey);
  const wsolAtaStr = wsolAta.toBase58();
  const fromAmount = BigInt(params.fromAmountLamports);

  const base: WsolSetupNeed = {
    needed: false,
    referenced: false,
    wsolAta: wsolAtaStr,
    exists: false,
    currentWrappedAmount: "0",
    lamportsToWrap: "0",
    rentLamports: "0",
    reason: "",
  };

  let tx: VersionedTransaction;
  try {
    tx = deserializeToVersioned(base64ToBytes(params.transactionBase64)).tx;
  } catch {
    return { ...base, reason: "could not deserialize tx" };
  }

  const connection = await resolveHealthySolanaConnection(config);

  // Only act if the route's tx actually references this wallet's wSOL ATA.
  const keys = await resolveMessageAccountKeys(connection, tx);
  const referenced = keys ? keys.has(wsolAta) : false;
  if (!referenced) {
    return { ...base, reason: "route does not reference this wallet's wSOL ATA" };
  }

  const info = await connection.getAccountInfo(wsolAta);
  const exists = info != null;
  const currentWrapped = exists ? readTokenAmount(info.data as Uint8Array) : 0n;
  const rentLamports = exists
    ? 0n
    : BigInt(
        await connection.getMinimumBalanceForRentExemption(
          SPL_TOKEN_ACCOUNT_LEN,
        ),
      );
  const lamportsToWrap =
    currentWrapped >= fromAmount ? 0n : fromAmount - currentWrapped;
  const needed = !exists || currentWrapped < fromAmount;

  const result: WsolSetupNeed = {
    needed,
    referenced,
    wsolAta: wsolAtaStr,
    exists,
    currentWrappedAmount: currentWrapped.toString(),
    lamportsToWrap: lamportsToWrap.toString(),
    rentLamports: rentLamports.toString(),
    reason: needed
      ? exists
        ? "wSOL ATA exists but is underfunded for the bridge amount"
        : "wSOL ATA does not exist"
      : "wSOL ATA already funded",
  };

  lastWsolSetupDebug = {
    wsolAta: wsolAtaStr,
    exists,
    currentWrappedAmount: result.currentWrappedAmount,
    lamportsToWrap: result.lamportsToWrap,
    rentLamports: result.rentLamports,
  };

  log("wsol-setup-needed", {
    wallet: walletPubkey.toBase58(),
    wsolAta: wsolAtaStr,
    referenced,
    exists,
    currentWrappedAmount: result.currentWrappedAmount,
    lamportsToWrap: result.lamportsToWrap,
    rentLamports: result.rentLamports,
    needed,
  });

  return result;
}

export type WsolSetupResult = { signature: string; wsolAta: string };

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function errName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

// Map a generic classification to a wSOL-setup-specific, phase-aware code so the
// failure is never flattened into a plain "RPC unavailable".
function mapSetupFailure(
  generic: SolanaErrorCode,
  phase: "simulate" | "send",
): SolanaErrorCode {
  if (generic === "INSUFFICIENT_SOL_FOR_FEE") return "WSOL_SETUP_INSUFFICIENT_SOL";
  if (generic === "BLOCKHASH_EXPIRED") return "WSOL_SETUP_BLOCKHASH_EXPIRED";
  if (generic === "SOLANA_NETWORK_ERROR") return "WSOL_SETUP_RPC_UNAVAILABLE";
  return phase === "simulate"
    ? "WSOL_SETUP_SIMULATION_FAILED"
    : "WSOL_SETUP_SEND_FAILED";
}

// Build → sign → SIMULATE → send → HTTP-poll confirm the wSOL setup tx
// (idempotent ATA create → lamport transfer → SyncNative). Separate from the
// provider tx (we never inject into it). Confirmation polls getSignatureStatuses
// over HTTP — no websocket dependency, which the public RPC often lacks. The
// secret key only constructs the in-memory signer and never leaves this function.
// Throws a phase-specific coded SolanaError on failure; never flattens to a
// generic RPC error unless the failure is truly network/RPC.
export async function executeWsolSetupTransaction(params: {
  secretKey: Uint8Array;
  lamportsToWrap: string;
  config?: SolanaChainConfig;
}): Promise<WsolSetupResult> {
  const config = params.config ?? SOLANA_MAINNET;
  let signer: Keypair;
  try {
    signer = Keypair.fromSecretKey(params.secretKey);
  } catch {
    throw solanaErrorFor("SIGNING_FAILED");
  }
  const owner = signer.publicKey;
  const wsolAta = wsolAtaFor(owner);
  const lamportsToWrap = BigInt(params.lamportsToWrap);

  const connection = await resolveHealthySolanaConnection(config);

  const instructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      wsolAta,
      owner,
      NATIVE_MINT,
    ),
  ];
  if (lamportsToWrap > 0n) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: wsolAta,
        lamports: lamportsToWrap,
      }),
    );
  }
  instructions.push(createSyncNativeInstruction(wsolAta));

  log("wsol-setup-built", {
    wallet: owner.toBase58(),
    wsolAta: wsolAta.toBase58(),
    lamportsToWrap: params.lamportsToWrap,
    instructionCount: instructions.length,
  });
  lastWsolSetupDebug = {
    ...(lastWsolSetupDebug ?? {}),
    wsolAta: wsolAta.toBase58(),
    lamportsToWrap: params.lamportsToWrap,
    instructionCount: instructions.length,
  };

  // ── Build + sign with a fresh blockhash ──
  let signedTx: Transaction;
  try {
    const latest = await connection.getLatestBlockhash("confirmed");
    signedTx = new Transaction({
      feePayer: owner,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(...instructions);
    signedTx.sign(signer);
  } catch (error) {
    const code = mapSetupFailure(
      classifySolanaFailure(errMsg(error), null),
      "send",
    );
    log("wsol-setup-send-failed", {
      errorName: errName(error),
      errorMessage: errMsg(error).slice(0, 200),
      errorCode: code,
      logsTail: [],
      lamportsToWrap: params.lamportsToWrap,
      wsolAta: wsolAta.toBase58(),
    });
    lastWsolSetupDebug = { ...(lastWsolSetupDebug ?? {}), sendError: code };
    throw solanaErrorFor(code);
  }

  // ── Simulate BEFORE broadcast ──
  try {
    const sim = await connection.simulateTransaction(signedTx);
    const ok = !sim.value.err;
    const errSummary = ok ? "" : summarizeSolanaErr(sim.value.err);
    const logsTail = compactLogs(sim.value.logs);
    log("wsol-setup-simulate", {
      ok,
      errSummary,
      logsTail,
      instructionCount: instructions.length,
      lamportsToWrap: params.lamportsToWrap,
      wsolAta: wsolAta.toBase58(),
      wallet: owner.toBase58(),
    });
    lastWsolSetupDebug = {
      ...(lastWsolSetupDebug ?? {}),
      simulateOk: ok,
      simulateErrSummary: ok ? null : errSummary,
      simulateLogs: logsTail,
    };
    if (!ok) {
      throw solanaErrorFor(
        mapSetupFailure(
          classifySolanaFailure(sim.value.err, sim.value.logs),
          "simulate",
        ),
      );
    }
  } catch (error) {
    if (error instanceof SolanaError) throw error;
    // simulateTransaction itself threw → RPC/network problem.
    log("wsol-setup-simulate", {
      ok: false,
      errSummary: errMsg(error).slice(0, 200),
      logsTail: [],
      instructionCount: instructions.length,
      lamportsToWrap: params.lamportsToWrap,
      wsolAta: wsolAta.toBase58(),
      wallet: owner.toBase58(),
    });
    throw solanaErrorFor("WSOL_SETUP_RPC_UNAVAILABLE");
  }

  // ── Send ──
  log("wsol-setup-send", {
    wsolAta: wsolAta.toBase58(),
    lamportsToWrap: params.lamportsToWrap,
  });
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 5,
    });
  } catch (error) {
    const logs = error instanceof SendTransactionError ? error.logs ?? null : null;
    const code = mapSetupFailure(
      classifySolanaFailure(errMsg(error), logs),
      "send",
    );
    log("wsol-setup-send-failed", {
      errorName: errName(error),
      errorMessage: errMsg(error).slice(0, 200),
      errorCode: code,
      logsTail: compactLogs(logs),
      lamportsToWrap: params.lamportsToWrap,
      wsolAta: wsolAta.toBase58(),
    });
    lastWsolSetupDebug = { ...(lastWsolSetupDebug ?? {}), sendError: code };
    throw solanaErrorFor(code);
  }
  log("wsol-setup-send", { signature });
  lastWsolSetupDebug = { ...(lastWsolSetupDebug ?? {}), sendSignature: signature };

  // ── Confirm via HTTP polling (no websocket dependency on the public RPC) ──
  log("wsol-setup-confirming", { signature });
  let confirmed = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const statuses = await connection.getSignatureStatuses([signature]);
      const status = statuses.value[0];
      if (status) {
        if (status.err) {
          // The tx landed but FAILED on-chain — do not resend.
          log("wsol-setup-confirm-failed", {
            signature,
            reason: summarizeSolanaErr(status.err),
          });
          lastWsolSetupDebug = {
            ...(lastWsolSetupDebug ?? {}),
            confirmError: `tx failed on-chain: ${summarizeSolanaErr(status.err)}`,
          };
          throw solanaErrorFor("WSOL_SETUP_SEND_FAILED");
        }
        const cs = status.confirmationStatus;
        if (cs === "confirmed" || cs === "finalized" || (status.confirmations ?? 0) > 0) {
          confirmed = true;
          break;
        }
      }
    } catch (error) {
      if (error instanceof SolanaError) throw error;
      // Transient RPC read error — keep polling until the attempt cap.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!confirmed) {
    // Submitted but not observed confirmed. Do NOT resend — the signature is
    // logged + stored in debug for manual inspection.
    log("wsol-setup-confirm-failed", {
      signature,
      reason: "confirmation timed out",
    });
    lastWsolSetupDebug = {
      ...(lastWsolSetupDebug ?? {}),
      confirmError: "confirmation timed out",
    };
    throw solanaErrorFor("WSOL_SETUP_CONFIRM_FAILED");
  }

  log("wsol-setup-confirmed", {
    wallet: owner.toBase58(),
    wsolAta: wsolAta.toBase58(),
    signature,
  });
  lastWsolSetupDebug = { ...(lastWsolSetupDebug ?? {}), confirmError: null };

  return { signature, wsolAta: wsolAta.toBase58() };
}

// Map a simulation/broadcast failure (err object/string + program logs) to a
// precise SolanaErrorCode. Order matters: the most specific signals win.
export function classifySolanaFailure(
  err: unknown,
  logs: string[] | null | undefined,
): SolanaErrorCode {
  const errText =
    typeof err === "string"
      ? err
      : err == null
        ? ""
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  const blob = `${errText} ${(logs ?? []).join(" ")}`.toLowerCase();

  if (
    blob.includes("blockhashnotfound") ||
    blob.includes("blockhash not found") ||
    blob.includes("block height exceeded") ||
    blob.includes("blockheightexceeded")
  ) {
    return "BLOCKHASH_EXPIRED";
  }
  if (
    blob.includes("signature verification") ||
    blob.includes("missing signature") ||
    blob.includes("signature failure") ||
    blob.includes("signaturefailure")
  ) {
    return "WRONG_SIGNER";
  }
  if (
    blob.includes("address lookup table") ||
    blob.includes("addresslookuptable") ||
    blob.includes("could not find address lookup") ||
    blob.includes("lookup table")
  ) {
    return "ALT_LOOKUP_FAILED";
  }
  if (
    blob.includes("insufficient lamports") ||
    blob.includes("insufficient funds") ||
    blob.includes("for rent") ||
    blob.includes("rent-exempt") ||
    blob.includes("insufficient")
  ) {
    return "INSUFFICIENT_SOL_FOR_FEE";
  }
  if (
    blob.includes("accountnotfound") ||
    blob.includes("account not found") ||
    blob.includes("invalid account data") ||
    blob.includes("could not find account") ||
    blob.includes("programaccountnotfound") ||
    blob.includes("incorrect program id") ||
    blob.includes("owner mismatch") ||
    blob.includes("illegal owner")
  ) {
    // The tx is valid; it just references an account that isn't usable. This is
    // a ROUTE problem, NOT an unsupported tx format.
    return "SOLANA_ACCOUNT_ERROR";
  }
  if (
    blob.includes("custom program error") ||
    blob.includes("instructionerror") ||
    blob.includes('"custom"') ||
    blob.includes("program failed to complete") ||
    blob.includes("program error")
  ) {
    return "SOLANA_PROGRAM_ERROR";
  }
  if (
    blob.includes("timeout") ||
    blob.includes("failed to fetch") ||
    blob.includes("rate limit") ||
    blob.includes("429") ||
    blob.includes("503") ||
    blob.includes("502")
  ) {
    return "SOLANA_NETWORK_ERROR";
  }
  // The tx deserialized but the route failed simulation for a reason we can't
  // pin down — still a route/simulation failure, never an "unsupported format".
  return "SOLANA_ROUTE_SIMULATION_FAILED";
}

// Trim simulation logs for dev output: keep the tail (where the failing program
// error usually lands) and cap line length so the console stays readable.
function compactLogs(logs: string[] | null | undefined): string[] {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  return logs.slice(-12).map((line) => (line.length > 200 ? `${line.slice(0, 200)}…` : line));
}

// One-line, safe summary of a simulation/broadcast `err` (object or string).
// Capped and never includes the tx, signatures or keys.
function summarizeSolanaErr(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err.slice(0, 200);
  try {
    return JSON.stringify(err).slice(0, 200);
  } catch {
    return String(err).slice(0, 200);
  }
}

// Latest safe Solana simulation/broadcast failure, for copyLastSolanaSimulationDebug().
let lastSolanaSimulationDebug: {
  category: string;
  errSummary: string;
  logs: string[];
} | null = null;

// Dev helper: print (and best-effort clipboard-copy) the latest safe Solana
// simulation failure — category, a one-line err summary and the program-log
// TAIL. Never the raw tx, signatures, private keys or seed. Attached to
// globalThis when bridge diagnostics are enabled (incl. the localStorage flag).
export function copyLastSolanaSimulationDebug(): typeof lastSolanaSimulationDebug {
  // eslint-disable-next-line no-console
  console.info("[bridge:solana] simulation-debug (latest)", lastSolanaSimulationDebug);
  try {
    const text = JSON.stringify(lastSolanaSimulationDebug ?? {}, null, 2);
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => unknown } } })
      .navigator?.clipboard?.writeText?.(text);
  } catch {
    // Clipboard is best-effort and never required.
  }
  return lastSolanaSimulationDebug;
}

// Latest safe instruction-level simulation failure, for the dev helper below.
let lastSolanaInstructionFailureDebug:
  | {
      category: string;
      errSummary: string;
      instructionIndex: number;
      reason: string;
      programId: string | null;
      programLabel: string;
      accounts: string[];
      accountKeyIndexes: number[];
      logs: string[];
    }
  | null = null;

// Dev helper: print (and best-effort clipboard-copy) the latest safe instruction
// failure — category, err summary, failing instruction index/reason, program
// id/label, involved account keys (or indexes) and the program-log tail. Never
// the raw tx, signatures, private keys or seed.
// Read the latest instruction failure (safe metadata). Used by the UI to append
// a dev-only "Instruction #N failed with <reason>" detail when debug is enabled.
export function getLastSolanaInstructionFailure(): typeof lastSolanaInstructionFailureDebug {
  return lastSolanaInstructionFailureDebug;
}

export function copyLastSolanaInstructionFailureDebug(): typeof lastSolanaInstructionFailureDebug {
  // eslint-disable-next-line no-console
  console.info(
    "[bridge:solana] instruction-failure-debug (latest)",
    lastSolanaInstructionFailureDebug,
  );
  try {
    const text = JSON.stringify(lastSolanaInstructionFailureDebug ?? {}, null, 2);
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => unknown } } })
      .navigator?.clipboard?.writeText?.(text);
  } catch {
    // Clipboard is best-effort and never required.
  }
  return lastSolanaInstructionFailureDebug;
}

// Latest safe SPL Token account failure, for copyLastSolanaTokenAccountFailureDebug().
let lastSolanaTokenAccountFailureDebug:
  | {
      instructionIndex: number;
      tokenInstructionName: string;
      tokenInstructionDiscriminator: number | null;
      programId: string | null;
      accounts: TokenAccountDiagnostic[];
      likelyCause: string | null;
      logs: string[];
    }
  | null = null;

// Dev helper: print (and best-effort clipboard-copy) the latest safe SPL Token
// account failure — failing instruction, decoded token-instruction name, and the
// per-account on-chain diagnostics (owner/lamports/dataLength/mint/state). Never
// the raw tx, account bytes, signatures, private keys or seed.
export function copyLastSolanaTokenAccountFailureDebug(): typeof lastSolanaTokenAccountFailureDebug {
  // eslint-disable-next-line no-console
  console.info(
    "[bridge:solana] token-account-failure-debug (latest)",
    lastSolanaTokenAccountFailureDebug,
  );
  try {
    const text = JSON.stringify(lastSolanaTokenAccountFailureDebug ?? {}, null, 2);
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => unknown } } })
      .navigator?.clipboard?.writeText?.(text);
  } catch {
    // Clipboard is best-effort and never required.
  }
  return lastSolanaTokenAccountFailureDebug;
}

// Latest safe wSOL setup-tx debug record (seeded by detect, augmented by execute).
type WsolSetupDebug = {
  wsolAta?: string;
  exists?: boolean;
  currentWrappedAmount?: string;
  lamportsToWrap?: string;
  rentLamports?: string;
  instructionCount?: number;
  simulateOk?: boolean;
  simulateErrSummary?: string | null;
  simulateLogs?: string[];
  sendSignature?: string;
  sendError?: string;
  confirmError?: string | null;
};
let lastWsolSetupDebug: WsolSetupDebug | null = null;

// Dev helper: print (and best-effort clipboard-copy) the latest safe wSOL setup
// diagnostics — ATA, lamports, instruction count, simulation err/logs, send
// signature and any send/confirm error. Never the raw tx, signatures, key or seed.
export function copyLastWsolSetupDebug(): WsolSetupDebug | null {
  // eslint-disable-next-line no-console
  console.info("[bridge:solana] wsol-setup-debug (latest)", lastWsolSetupDebug);
  try {
    const text = JSON.stringify(lastWsolSetupDebug ?? {}, null, 2);
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => unknown } } })
      .navigator?.clipboard?.writeText?.(text);
  } catch {
    // Clipboard is best-effort and never required.
  }
  return lastWsolSetupDebug;
}

if (isBridgeDebugEnabled()) {
  (globalThis as Record<string, unknown>).copyLastSolanaSimulationDebug =
    copyLastSolanaSimulationDebug;
  (globalThis as Record<string, unknown>).copyLastSolanaInstructionFailureDebug =
    copyLastSolanaInstructionFailureDebug;
  (globalThis as Record<string, unknown>).copyLastSolanaTokenAccountFailureDebug =
    copyLastSolanaTokenAccountFailureDebug;
  (globalThis as Record<string, unknown>).copyLastWsolSetupDebug =
    copyLastWsolSetupDebug;
}

export type SolanaBridgeExecuteResult = {
  signature: string;
  diagnostics: SolanaBridgeTxDiagnostics;
};

// Full execute pipeline for a provider-built Solana bridge transaction. Throws a
// coded SolanaError (never a raw RPC string) on any failure so the UI can map it
// to a precise, safe message. BLOCKHASH_EXPIRED is the caller's cue to refresh
// the quote once and retry with a fresh transaction.
export async function executeSolanaBridgeTransaction(params: {
  transactionBase64: string;
  secretKey: Uint8Array;
  config?: SolanaChainConfig;
}): Promise<SolanaBridgeExecuteResult> {
  const config = params.config ?? SOLANA_MAINNET;

  let signer: Keypair;
  try {
    signer = Keypair.fromSecretKey(params.secretKey);
  } catch {
    throw solanaErrorFor("SIGNING_FAILED");
  }

  const { tx, diag } = inspect(params.transactionBase64, signer.publicKey);

  log("inspect", {
    format: diag.format,
    byteLength: diag.byteLength,
    recentBlockhash: diag.recentBlockhash,
    feePayer: diag.feePayer,
    numRequiredSignatures: diag.numRequiredSignatures,
    signatureCount: diag.signatureCount,
    emptySignatureCount: diag.emptySignatureCount,
    usesAddressLookupTables: diag.usesAddressLookupTables,
    walletIsRequiredSigner: diag.walletIsRequiredSigner,
    signer: signer.publicKey.toBase58(),
  });

  // The active wallet must be one of the required signers, otherwise signing
  // would fail with an opaque "non signer" error from web3.js.
  if (diag.numRequiredSignatures > 0 && !diag.walletIsRequiredSigner) {
    log("wrong-signer", { signer: signer.publicKey.toBase58() });
    throw solanaErrorFor("WRONG_SIGNER");
  }

  // One healthy endpoint for validate + simulate + broadcast, so all three agree
  // on the same node (we never rotate mid-broadcast — that could double-send).
  const connection = await resolveHealthySolanaConnection(config);

  // ── Validate blockhash BEFORE signing ──
  if (diag.recentBlockhash) {
    try {
      const res = await connection.isBlockhashValid(diag.recentBlockhash, {
        commitment: "confirmed",
      });
      log("blockhash-validity", { valid: res.value });
      if (res.value === false) {
        throw solanaErrorFor("BLOCKHASH_EXPIRED");
      }
    } catch (error) {
      // A coded BLOCKHASH_EXPIRED propagates; any other failure (e.g. RPC
      // doesn't support the method) is treated as "unknown" — we proceed and let
      // simulation be the authoritative check rather than blocking a good tx.
      if (error instanceof SolanaError) {
        throw error;
      }
      log("blockhash-validity", { valid: "unknown" });
    }
  }

  // ── Sign locally ──
  try {
    tx.sign([signer]);
  } catch (error) {
    const text = error instanceof Error ? error.message.toLowerCase() : "";
    if (text.includes("non signer") || text.includes("not a signer")) {
      throw solanaErrorFor("WRONG_SIGNER");
    }
    throw solanaErrorFor("SIGNING_FAILED");
  }
  const signedBytes = tx.serialize();

  // ── Simulate BEFORE broadcast (sigVerify catches a wrong/incomplete signer;
  // replaceRecentBlockhash:false tests the ACTUAL provider blockhash) ──
  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: true,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    });
    if (sim.value.err) {
      const baseCode = classifySolanaFailure(sim.value.err, sim.value.logs);
      const errSummary = summarizeSolanaErr(sim.value.err);
      const logsTail = compactLogs(sim.value.logs);

      // Instruction-level diagnosis (best-effort; resolves which program/accounts
      // failed and refines token- vs bridge- vs generic-account errors).
      const diagResult = await diagnoseInstructionFailure({
        connection,
        tx,
        err: sim.value.err,
        diag,
      }).catch(() => null);

      let code = baseCode;
      if (diagResult) {
        const instr = diagResult.info;
        log("simulation-instruction-failed", {
          instructionIndex: instr.instructionIndex,
          reason: instr.reason,
          programId: instr.programId,
          programLabel: instr.programLabel,
          accountCount: instr.accountCount,
          accounts: instr.accounts,
          programIdIndex: instr.programIdIndex,
          accountKeyIndexes: instr.accountKeyIndexes,
          staticAccountKeyCount: instr.staticAccountKeyCount,
          resolvedAccountKeys: instr.resolvedAccountKeys,
          usesAddressLookupTables: diag.usesAddressLookupTables,
          txFormat: diag.format,
        });
        code = refineAccountErrorCode(baseCode, instr.programFamily);
        lastSolanaInstructionFailureDebug = {
          category: code,
          errSummary,
          instructionIndex: instr.instructionIndex,
          reason: instr.reason,
          programId: instr.programId,
          programLabel: instr.programLabel,
          accounts: instr.accounts,
          accountKeyIndexes: instr.accountKeyIndexes,
          logs: logsTail,
        };

        // SPL Token deep-dive: decode the instruction + inspect each involved
        // account on-chain (owner / lamports / dataLength / mint / state).
        if (instr.programFamily === "token" || instr.programFamily === "ata") {
          const tokenInstructionName = splTokenInstructionName(
            diagResult.discriminator,
          );
          const tokenDiag = await inspectTokenAccounts(
            connection,
            diagResult.pubkeys,
          ).catch(() => null);
          log("spl-token-instruction-failed", {
            instructionIndex: instr.instructionIndex,
            tokenInstructionName,
            tokenInstructionDiscriminator: diagResult.discriminator,
            programId: instr.programId,
            accounts: instr.accounts,
            accountKeyIndexes: instr.accountKeyIndexes,
            accountDiagnostics: tokenDiag?.accounts ?? [],
            likelyCause: tokenDiag?.likelyCause ?? null,
          });
          lastSolanaTokenAccountFailureDebug = {
            instructionIndex: instr.instructionIndex,
            tokenInstructionName,
            tokenInstructionDiscriminator: diagResult.discriminator,
            programId: instr.programId,
            accounts: tokenDiag?.accounts ?? [],
            likelyCause: tokenDiag?.likelyCause ?? null,
            logs: logsTail,
          };
        }
      }

      lastSolanaSimulationDebug = { category: code, errSummary, logs: logsTail };
      log("simulate-failed", { category: code, errSummary, logsTail });
      throw solanaErrorFor(code);
    }
    log("simulate-ok", { unitsConsumed: sim.value.unitsConsumed ?? null });
  } catch (error) {
    if (error instanceof SolanaError) {
      // Already a coded SolanaError from the err-classification above.
      throw error;
    }
    // simulateTransaction itself threw (RPC issue / sig verification rejection).
    const code = classifySolanaFailure(
      error instanceof Error ? error.message : String(error),
      error instanceof SendTransactionError ? error.logs : null,
    );
    log("simulate-threw", { category: code });
    throw solanaErrorFor(
      code === "SOLANA_ROUTE_SIMULATION_FAILED" ? "SOLANA_NETWORK_ERROR" : code,
    );
  }

  // ── Broadcast (preflight ON so the cluster validates once more) ──
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signedBytes, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 5,
    });
  } catch (error) {
    const logs =
      error instanceof SendTransactionError ? error.logs ?? null : null;
    const code = classifySolanaFailure(
      error instanceof Error ? error.message : String(error),
      logs,
    );
    const errSummary = summarizeSolanaErr(
      error instanceof Error ? error.message : String(error),
    );
    const logsTail = compactLogs(logs);
    lastSolanaSimulationDebug = { category: code, errSummary, logs: logsTail };
    log("broadcast-failed", { category: code, errSummary, logsTail });
    throw solanaErrorFor(
      code === "SOLANA_ROUTE_SIMULATION_FAILED" ? "BROADCAST_FAILED" : code,
    );
  }

  log("broadcast-ok", { signature });

  // ── Best-effort confirmation (bounded; never blocks the popup for long) ──
  // Final cross-chain status is tracked by the gateway /status poll in the UI;
  // here we just give the signature a short head start to land.
  try {
    const status = await connection.getSignatureStatus(signature);
    log("confirm", {
      confirmationStatus: status.value?.confirmationStatus ?? "pending",
      hasErr: Boolean(status.value?.err),
    });
  } catch {
    // Confirmation read is best-effort — the signature is already broadcast.
  }

  return { signature, diagnostics: diag };
}
