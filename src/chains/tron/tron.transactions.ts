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
