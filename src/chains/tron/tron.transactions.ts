// src/chains/tron/tron.transactions.ts
//
// High-level TRON transaction operations (TRX + TRC-20 send, status polling).
// The actual build/sign/broadcast primitives live in tron.signer.ts and
// tron.trc20.ts; this module composes them and keeps the shapes the adapter
// already consumes.
//
// SECURITY: the private key is supplied by the wallet service (derived from the
// encrypted vault) and never crosses into the React UI.

import { getTronWeb } from "./tron.balance";
import { isValidTronAddress } from "./tron.address";
import { tronError, normalizeTronError } from "./tron.errors";
import {
  sendTrxTransaction,
  signTronTransaction,
  sendSignedTronTransaction,
} from "./tron.signer";
import { buildTrc20TransferTransaction } from "./tron.trc20";

export type TronTransactionStatus = "pending" | "confirmed" | "failed";

export type SendTronResult = {
  txId: string;
};

export type SendTrxInput = {
  privateKey: string;
  fromAddress: string;
  toAddress: string;
  amountSun: bigint;
};

export type SendTrc20Input = {
  privateKey: string;
  fromAddress: string;
  toAddress: string;
  contractAddress: string;
  amountBaseUnits: bigint;
  feeLimitSun?: number;
};

function assertValidRecipient(toAddress: string): void {
  if (!isValidTronAddress(toAddress)) {
    throw tronError("INVALID_TRON_ADDRESS", "Invalid recipient address.");
  }
}

export async function sendTrx(input: SendTrxInput): Promise<SendTronResult> {
  assertValidRecipient(input.toAddress);

  return sendTrxTransaction({
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountSun: input.amountSun,
    privateKey: input.privateKey,
  });
}

export async function sendTrc20(input: SendTrc20Input): Promise<SendTronResult> {
  assertValidRecipient(input.toAddress);

  if (input.amountBaseUnits <= 0n) {
    throw tronError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  try {
    const unsignedTx = await buildTrc20TransferTransaction({
      contractAddress: input.contractAddress,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      amount: input.amountBaseUnits,
      feeLimit: input.feeLimitSun,
    });

    const signedTx = await signTronTransaction(unsignedTx, input.privateKey);

    // NOTE: USDT TRC-20 does not reliably return a boolean from transfer(); we
    // intentionally do NOT gate success on a return value. A successful
    // broadcast means "submitted" — final success is determined by polling.
    return sendSignedTronTransaction(signedTx);
  } catch (error) {
    throw normalizeTronError(error, { isToken: true });
  }
}

// Poll a transaction's on-chain status. While TronGrid has no info yet the tx is
// still pending; once info exists, a non-SUCCESS contract receipt or a FAILED
// result means it failed, otherwise it is confirmed. Transient network errors
// are reported as pending so callers keep polling.
export async function getTronTransactionStatus(
  txId: string,
): Promise<TronTransactionStatus> {
  try {
    const info = (await getTronWeb().trx.getTransactionInfo(txId)) as {
      id?: string;
      blockNumber?: number;
      result?: string;
      receipt?: { result?: string };
    } | null;

    if (!info || Object.keys(info).length === 0) {
      return "pending";
    }

    if (info.result === "FAILED") {
      return "failed";
    }

    const receiptResult = info.receipt?.result;

    if (receiptResult && receiptResult !== "SUCCESS") {
      return "failed";
    }

    if (info.blockNumber || info.id) {
      return "confirmed";
    }

    return "pending";
  } catch {
    return "pending";
  }
}

// A classified TRON receipt failure reason. OUT_OF_ENERGY / REVERT / OUT_OF_TIME
// come straight from the contract receipt; FAILED is a generic on-chain failure.
export type TronReceiptReasonCode =
  | "OUT_OF_ENERGY"
  | "REVERT"
  | "OUT_OF_TIME"
  | "FAILED"
  | null;

export type TronTransactionReceipt = {
  status: TronTransactionStatus;
  // Classified failure reason (null while pending / on success).
  reasonCode: TronReceiptReasonCode;
  // Short, display-safe human reason decoded from the receipt, if any.
  reasonMessage: string | null;
};

// Decode TRON's hex-encoded resMessage (e.g. "Not enough energy for 'LOG3'…")
// into UTF-8 text. Returns null when absent/undecodable — never throws.
function decodeTronResMessage(hex: unknown): string | null {
  if (typeof hex !== "string" || hex.trim() === "") return null;
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/u.test(clean) || clean.length % 2 !== 0) {
    // Some nodes already return plain text — surface it as-is (capped).
    return hex.slice(0, 200);
  }
  try {
    let out = "";
    for (let i = 0; i < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    }
    // Keep only printable ASCII; cap length so nothing huge reaches the UI/logs.
    const printable = out.replace(/[^\x20-\x7e]/gu, "").trim();
    return printable ? printable.slice(0, 200) : null;
  } catch {
    return null;
  }
}

// Classify a receipt's contract-result string into a stable reason code.
function classifyReceiptResult(
  receiptResult: string | undefined,
  resMessage: string | null,
): TronReceiptReasonCode {
  const r = (receiptResult ?? "").toUpperCase();
  const m = (resMessage ?? "").toLowerCase();
  if (r === "OUT_OF_ENERGY" || m.includes("not enough energy") || m.includes("energy")) {
    return "OUT_OF_ENERGY";
  }
  if (r === "REVERT" || m.includes("revert")) return "REVERT";
  if (r === "OUT_OF_TIME" || r === "OUT_OF_TIMES") return "OUT_OF_TIME";
  return "FAILED";
}

// Richer status read that also returns WHY a tx failed (energy/revert/…), so the
// approval UI can show a precise, actionable message. Same pending/confirmed/
// failed semantics as getTronTransactionStatus; transient errors → pending.
export async function getTronTransactionReceipt(
  txId: string,
): Promise<TronTransactionReceipt> {
  try {
    const info = (await getTronWeb().trx.getTransactionInfo(txId)) as {
      id?: string;
      blockNumber?: number;
      result?: string;
      resMessage?: string;
      receipt?: { result?: string };
      contractResult?: string[];
    } | null;

    if (!info || Object.keys(info).length === 0) {
      return { status: "pending", reasonCode: null, reasonMessage: null };
    }

    const resMessage = decodeTronResMessage(info.resMessage);
    const receiptResult = info.receipt?.result;
    const topFailed = info.result === "FAILED";
    const receiptFailed = Boolean(receiptResult && receiptResult !== "SUCCESS");

    if (topFailed || receiptFailed) {
      return {
        status: "failed",
        reasonCode: classifyReceiptResult(receiptResult, resMessage),
        reasonMessage: resMessage,
      };
    }

    if (info.blockNumber || info.id) {
      return { status: "confirmed", reasonCode: null, reasonMessage: null };
    }

    return { status: "pending", reasonCode: null, reasonMessage: null };
  } catch {
    return { status: "pending", reasonCode: null, reasonMessage: null };
  }
}
