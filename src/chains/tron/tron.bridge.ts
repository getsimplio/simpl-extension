// src/chains/tron/tron.bridge.ts
//
// Cross-chain (LI.FI) TRON SOURCE transaction execution + quote-shape extraction.
// LI.FI returns a TRON-source route's transaction in an EVM-LOOKING wrapper
// ({ from, to, chainId, data, value, gasLimit }) where `to`/`from` are base58
// T... addresses and `data` is the hex-encoded TRON `raw_data` (protobuf — it
// always begins with the 0x0a ref_block_bytes tag), NOT EVM calldata. We never
// route a TRON tx through the EVM signer.
//
// The execute pipeline owns the full failure classification, never a flattened
// "broadcast failed":
//
//   extract raw_data_hex → validate shape → compute txID → sign txID locally →
//   assemble the signed Transaction protobuf → broadcast via /wallet/broadcasthex
//
// This is type-agnostic: we need ONLY the provider's raw_data_hex (no raw_data
// JSON), so any TRON contract the bridge builds — TriggerSmartContract, native
// TransferContract, a TRC-20 approve — broadcasts the same way.
//
// SECURITY: the private key only constructs the local signature and never leaves
// this module — never logged, returned or persisted. Diagnostics ([bridge:tron])
// log only safe metadata: field NAMES, value TYPES, string LENGTHS, the public
// txid/addresses — never the raw_data, the signature, the private key or the seed.

import { TronWeb } from "tronweb";
import { getTronWeb } from "./tron.balance";
import { isValidTronAddress } from "./tron.address";
import { tronError, normalizeTronError, TronError } from "./tron.errors";
import { buildTrc20ApproveTransaction } from "./tron.trc20";
import { signTronTransaction, sendSignedTronTransaction } from "./tron.signer";
// The single bridge-debug gate lives in solana.bridge so quote- and
// execution-side diagnostics across every VM flip together with one flag.
import { isBridgeDebugEnabled } from "../solana/solana.bridge";

export { isBridgeDebugEnabled };

// Structured diagnostics, prefixed [bridge:tron]. Privacy-safe by construction —
// callers must never pass the raw_data, the signature, or key material.
function log(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[bridge:tron] ${event}`, data);
}

function warn(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.warn(`[bridge:tron] ${event}`, data);
}

// ── Hex helpers ──────────────────────────────────────────────────────────────

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function isHexString(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/u.test(value);
}

// TRON raw_data is a protobuf message whose first field is `ref_block_bytes`
// (field 1, wire type 2) → it ALWAYS serializes with a leading 0x0a tag. This is
// the cheap, reliable signal that a hex blob is a TRON transaction body rather
// than EVM calldata (which begins with a 4-byte function selector).
function looksLikeTronRawData(hexNoPrefix: string): boolean {
  return (
    isHexString(hexNoPrefix) &&
    hexNoPrefix.length >= 40 &&
    hexNoPrefix.slice(0, 2).toLowerCase() === "0a"
  );
}

// Encode a non-negative integer as a protobuf base-128 varint (hex).
function varintHex(value: number): string {
  let n = value;
  const bytes: number[] = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Quote-shape extraction ───────────────────────────────────────────────────

// Safe, value-free summary of a TRON provider payload shape — for diagnostics.
export type TronTxShapeSummary = {
  payloadType: string;
  keys: string[];
  candidateField: string | null;
  stringLength: number | null;
  // First two hex chars of the candidate (the protobuf tag) — safe, not secret.
  firstByte: string | null;
  reason: string | null;
};

export type TronTxExtractionOk = {
  ok: true;
  // The TRON raw_data, hex WITHOUT a 0x prefix — the only thing the executor
  // needs to sign + broadcast.
  rawDataHex: string;
  // Where it was found, qualified by the root (diagnostics / invariant).
  sourceField: string;
  // How the provider represented the tx: a bare raw_data_hex string, a
  // TronWeb-style transaction object, or a serialized field.
  txShape: "rawDataHex" | "tronTxObject" | "serialized";
  // feeLimit (sun) if the provider exposed one, else null (defaulted later).
  feeLimit: string | null;
  // The base58 owner (`from`) the provider built the tx for, when present.
  fromAddress: string | null;
  // The base58 contract/recipient (`to`) the tx targets, when present.
  toAddress: string | null;
};

export type TronTxExtraction =
  | TronTxExtractionOk
  | {
      ok: false;
      reason: string;
      // True when the provider returned a route that needs a separate TRON tx
      // BUILD step rather than a ready raw_data_hex — distinct from "no payload".
      requiresBuild: boolean;
      shapeSummary: TronTxShapeSummary;
    };

// Candidate fields that may carry the TRON tx body inside a request object.
const TRON_TX_STRING_FIELDS = [
  "data",
  "raw_data_hex",
  "rawDataHex",
  "serializedTransaction",
  "rawTransaction",
  "tx",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const v = record[key];
  return typeof v === "string" ? v : null;
}

// gasLimit/feeLimit may arrive as a hex string ("0x…"), a decimal string or a
// number. Normalize to a decimal sun string; null when absent/unparseable.
function readFeeLimit(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const raw = record.feeLimit ?? record.fee_limit ?? record.gasLimit;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return BigInt(Math.trunc(raw)).toString();
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      return BigInt(raw.trim()).toString();
    } catch {
      return null;
    }
  }
  return null;
}

// Pull a raw_data_hex out of a single request-like object. Probes the known
// string fields, then a nested TronWeb-style transaction object
// ({ raw_data_hex, txID }) one level deep under `transaction`/`raw_data`.
function extractFromRequest(
  request: unknown,
  rootLabel: string,
): TronTxExtractionOk | null {
  const record = asRecord(request);
  if (!record) return null;

  const fromAddress = readString(record, "from") ?? readString(record, "owner_address");
  const toAddress = readString(record, "to");
  const feeLimit = readFeeLimit(record);

  // 1) Bare hex-string fields (LI.FI uses `data`).
  for (const field of TRON_TX_STRING_FIELDS) {
    const value = readString(record, field);
    if (value == null) continue;
    const hex = stripHexPrefix(value.trim());
    if (looksLikeTronRawData(hex)) {
      return {
        ok: true,
        rawDataHex: hex.toLowerCase(),
        sourceField: `${rootLabel}.${field}`,
        txShape: "rawDataHex",
        feeLimit,
        fromAddress,
        toAddress,
      };
    }
  }

  // 2) Nested TronWeb-style transaction object: { txID, raw_data, raw_data_hex }.
  for (const nestKey of ["transaction", "raw_data"]) {
    const nested = asRecord(record[nestKey]);
    if (!nested) continue;
    const nestedHex =
      readString(nested, "raw_data_hex") ?? readString(nested, "rawDataHex");
    if (nestedHex != null) {
      const hex = stripHexPrefix(nestedHex.trim());
      if (looksLikeTronRawData(hex)) {
        return {
          ok: true,
          rawDataHex: hex.toLowerCase(),
          sourceField: `${rootLabel}.${nestKey}.raw_data_hex`,
          txShape: "tronTxObject",
          feeLimit: feeLimit ?? readFeeLimit(nested),
          fromAddress,
          toAddress: toAddress ?? readString(nested, "to"),
        };
      }
    }
  }

  return null;
}

function shapeSummaryFor(quote: unknown): TronTxShapeSummary {
  const root = asRecord(quote);
  const txReq = asRecord(root?.transactionRequest);
  const dataStr = readString(txReq, "data");
  const dataHex = dataStr ? stripHexPrefix(dataStr) : null;
  return {
    payloadType: txReq ? "object" : root ? "object" : typeof quote,
    keys: txReq ? Object.keys(txReq) : root ? Object.keys(root) : [],
    candidateField: dataStr != null ? "transactionRequest.data" : null,
    stringLength: dataStr != null ? dataStr.length : null,
    firstByte: dataHex && dataHex.length >= 2 ? dataHex.slice(0, 2).toLowerCase() : null,
    reason: null,
  };
}

// THE single TRON extraction entry point. Searches the whole raw quote — not just
// transactionRequest — because providers nest the executable payload in different
// places (Allbridge/LI.FI advanced routes). Returns the raw_data_hex + where it
// came from, or a safe shape summary explaining why none worked.
export function extractTronTransactionRequest(quote: unknown): TronTxExtraction {
  const root = asRecord(quote);
  if (!root) {
    return {
      ok: false,
      reason: "Quote is not an object.",
      requiresBuild: false,
      shapeSummary: shapeSummaryFor(quote),
    };
  }

  const roots: Array<{ label: string; value: unknown }> = [
    { label: "transactionRequest", value: root.transactionRequest },
    { label: "root", value: root },
    { label: "toolData", value: root.toolData },
    { label: "providerData", value: root.providerData },
  ];
  const steps = Array.isArray(root.includedSteps)
    ? root.includedSteps
    : Array.isArray(root.steps)
      ? root.steps
      : [];
  steps.forEach((step, i) => {
    const so = asRecord(step);
    if (so) {
      roots.push({
        label: `includedSteps[${i}].transactionRequest`,
        value: so.transactionRequest,
      });
      roots.push({ label: `includedSteps[${i}]`, value: so });
    }
  });

  // A route that returned an instruction-bundle / unsigned-build object rather
  // than a ready raw_data_hex needs a build step we don't implement.
  let requiresBuild = false;

  for (const candidate of roots) {
    if (candidate.value == null) continue;
    const found = extractFromRequest(candidate.value, candidate.label);
    if (found) {
      log("tx-extracted", {
        sourceField: found.sourceField,
        txShape: found.txShape,
        rawDataHexLength: found.rawDataHex.length,
        firstByte: found.rawDataHex.slice(0, 2),
        feeLimit: found.feeLimit,
        fromAddressType: found.fromAddress ? "tron" : "none",
        toAddressType: found.toAddress ? "tron" : "none",
      });
      return found;
    }
    const rec = asRecord(candidate.value);
    if (rec && (Array.isArray(rec.instructions) || rec.build === true)) {
      requiresBuild = true;
    }
  }

  const shapeSummary = shapeSummaryFor(quote);
  shapeSummary.reason = "no decodable TRON raw_data_hex in any known location";
  warn("inspect", { where: "quote", requiresBuild, ...shapeSummary });
  return {
    ok: false,
    reason: "Provider returned no executable TRON transaction.",
    requiresBuild,
    shapeSummary,
  };
}

// Dev-only [bridge:tron] invalid-tx diagnostic (safe metadata only).
export function logTronInvalidTx(summary: TronTxShapeSummary, where: string): void {
  warn("inspect", { where, ...summary });
}

// ── Execution ────────────────────────────────────────────────────────────────

export type TronBridgeExecuteResult = {
  txId: string;
};

// Compute the TRON txID (SHA-256 of the raw_data bytes), hex.
function computeTxId(tronWeb: TronWeb, rawDataHex: string): string {
  const rawBytes = tronWeb.utils.code.hexStr2byteArray(rawDataHex);
  return tronWeb.utils.bytes.byteArray2hexStr(tronWeb.utils.crypto.SHA256(rawBytes)).toLowerCase();
}

// Assemble the full signed Transaction protobuf hex from the raw_data and the
// 65-byte signature: field 1 (raw_data, wire type 2) + field 2 (signature, wire
// type 2). This is exactly what TronWeb serializes for a signed tx; verified
// byte-identical against txJsonToPb + the signature field.
function assembleSignedTxHex(rawDataHex: string, signatureHex: string): string {
  const rawLen = rawDataHex.length / 2;
  const sigLen = signatureHex.length / 2;
  return (
    "0a" +
    varintHex(rawLen) +
    rawDataHex +
    "12" +
    varintHex(sigLen) +
    signatureHex
  ).toLowerCase();
}

// Full execute pipeline for a provider-built TRON bridge transaction. Throws a
// coded TronError (never a raw RPC string) on any failure. The signer address is
// re-derived from the key and asserted to match the active TRON account before we
// touch the network — a TRON tx is never signed by the wrong account.
export async function executeTronBridgeTransaction(params: {
  rawDataHex: string;
  privateKey: string;
  // The active account's base58 TRON address; must match the key AND, when the
  // provider exposed it, the tx's `from`/owner.
  expectedFromAddress: string;
  // The tx's `from` as reported by the quote (base58), for a final signer check.
  quoteFromAddress?: string | null;
}): Promise<TronBridgeExecuteResult> {
  const rawDataHex = stripHexPrefix(params.rawDataHex.trim()).toLowerCase();
  if (!looksLikeTronRawData(rawDataHex)) {
    throw tronError(
      "TRON_BUILD_TX_FAILED",
      "TRON transaction format is not supported yet.",
    );
  }

  const privateKey = stripHexPrefix(params.privateKey.trim());
  if (!/^[0-9a-fA-F]{64}$/u.test(privateKey)) {
    throw tronError("TRON_SIGN_FAILED", "Could not sign the transaction.");
  }

  // Signer must be the active TRON account.
  let signerAddress: string;
  try {
    signerAddress = TronWeb.address.fromPrivateKey(privateKey) as string;
  } catch {
    throw tronError("TRON_SIGN_FAILED", "Could not sign the transaction.");
  }
  if (
    !isValidTronAddress(params.expectedFromAddress) ||
    signerAddress !== params.expectedFromAddress
  ) {
    throw tronError(
      "INVALID_TRON_ADDRESS",
      "This route needs a different TRON signer than your active account.",
    );
  }
  if (
    params.quoteFromAddress &&
    isValidTronAddress(params.quoteFromAddress) &&
    params.quoteFromAddress !== signerAddress
  ) {
    throw tronError(
      "INVALID_TRON_ADDRESS",
      "This route was built for a different TRON account.",
    );
  }

  const tronWeb = getTronWeb();
  const txId = computeTxId(tronWeb, rawDataHex);

  log("inspect", {
    txId,
    rawDataHexLength: rawDataHex.length,
    firstByte: rawDataHex.slice(0, 2),
    signer: signerAddress,
    feeLimitPresent: params.quoteFromAddress != null,
  });

  // Sign the txID locally (secp256k1 recoverable). ECKeySign over the txID hash
  // matches trx.sign byte-for-byte but skips owner-address validation, which we
  // have already enforced above. The key never leaves this function.
  let signatureHex: string;
  try {
    const priKeyBytes = tronWeb.utils.code.hexStr2byteArray(privateKey);
    const txIdBytes = tronWeb.utils.code.hexStr2byteArray(txId);
    signatureHex = stripHexPrefix(
      (tronWeb.utils.crypto.ECKeySign(txIdBytes, priKeyBytes) as string),
    ).toLowerCase();
  } catch {
    throw tronError("TRON_SIGN_FAILED", "Could not sign the transaction.");
  }
  if (!isHexString(signatureHex) || signatureHex.length !== 130) {
    throw tronError("TRON_SIGN_FAILED", "Could not sign the transaction.");
  }

  const signedTxHex = assembleSignedTxHex(rawDataHex, signatureHex);

  // Broadcast the assembled signed transaction via /wallet/broadcasthex — the one
  // path that needs only raw_data_hex (no raw_data JSON), so it is contract-type
  // agnostic.
  let result: { result?: boolean; txid?: string; code?: unknown; message?: string };
  try {
    result = (await tronWeb.trx.sendHexTransaction(signedTxHex)) as typeof result;
  } catch (error) {
    log("failed", { phase: "broadcast", txId });
    throw normalizeTronError(error);
  }

  if (result?.result === true || typeof result?.txid === "string") {
    const broadcastTxId = result.txid ?? txId;
    log("broadcast-ok", { txId: broadcastTxId });
    return { txId: broadcastTxId };
  }

  log("failed", { phase: "broadcast", txId, hasCode: result?.code != null });
  throw normalizeTronError(result?.message ?? result?.code ?? result);
}

// ── TRC-20 approval (source-token allowance) ─────────────────────────────────

// Read a TRC-20 allowance (base units) for owner→spender. Read-only constant
// call; works without a signer. Returns null on a failed read (caller decides).
export async function readTrc20Allowance(params: {
  owner: string;
  contractAddress: string;
  spender: string;
}): Promise<bigint | null> {
  try {
    const tronWeb = getTronWeb();
    const result = await tronWeb.transactionBuilder.triggerConstantContract(
      params.contractAddress,
      "allowance(address,address)",
      {},
      [
        { type: "address", value: params.owner },
        { type: "address", value: params.spender },
      ],
      params.owner,
    );
    const hex = result?.constant_result?.[0];
    if (!hex || typeof hex !== "string") return null;
    return BigInt(`0x${hex}`);
  } catch {
    return null;
  }
}

// Build → sign → broadcast a TRC-20 approve(spender, amount) for a TRON-source
// bridge whose provider requires an allowance. Unlike the bridge tx itself this
// is a locally-built TronWeb transaction (we have the full raw_data), so it reuses
// the standard JSON sign + broadcast path. Returns the approve txid.
export async function executeTronBridgeApproval(params: {
  contractAddress: string;
  spender: string;
  amountBaseUnits: bigint;
  privateKey: string;
  fromAddress: string;
  feeLimitSun?: number;
}): Promise<TronBridgeExecuteResult> {
  if (!isValidTronAddress(params.spender)) {
    throw tronError("INVALID_TRON_ADDRESS", "Invalid approval address.");
  }
  log("approve-needed", {
    contract: params.contractAddress,
    spender: params.spender,
    amountBaseUnits: params.amountBaseUnits.toString(),
  });

  let unsignedTx;
  try {
    unsignedTx = await buildTrc20ApproveTransaction({
      contractAddress: params.contractAddress,
      fromAddress: params.fromAddress,
      spender: params.spender,
      amount: params.amountBaseUnits,
      feeLimit: params.feeLimitSun,
    });
  } catch (error) {
    throw normalizeTronError(error, { isToken: true });
  }

  const signedTx = await signTronTransaction(unsignedTx, params.privateKey);
  const { txId } = await sendSignedTronTransaction(signedTx);
  log("approve-submitted", { txId });
  return { txId };
}

// Re-export TronError so bridge callers can branch on TRON failure codes without
// importing the errors module separately.
export { TronError };
