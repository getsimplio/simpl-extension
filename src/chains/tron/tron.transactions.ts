// src/chains/tron/tron.transactions.ts
//
// Build, sign and broadcast TRON transactions, plus status polling.
//
// SECURITY: signing happens here, inside the wallet/background service layer.
// The private key is supplied by the wallet service (derived from the encrypted
// vault) and never crosses into the React UI.

import { TRC20_DEFAULT_FEE_LIMIT_SUN } from "./tron.config";
import { getTronWeb } from "./tron.balance";
import { isValidTronAddress } from "./tron.address";
import { normalizeTronError } from "./tron.errors";

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
    throw new Error("Invalid recipient address.");
  }
}

// A broadcast is "submitted" when TronGrid acknowledges it. TronWeb returns
// either { result: true, txid } or a failure object with a (often hex-encoded)
// message — surface the latter as a normalized error.
function extractTxId(broadcast: unknown, signedTxId: string): string {
  const record = (broadcast ?? {}) as {
    result?: boolean;
    txid?: string;
    code?: string;
    message?: string;
  };

  if (record.result === true || typeof record.txid === "string") {
    return record.txid ?? signedTxId;
  }

  throw normalizeTronError(record.message ?? record.code ?? record);
}

export async function sendTrx(input: SendTrxInput): Promise<SendTronResult> {
  assertValidRecipient(input.toAddress);

  if (input.amountSun <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  try {
    const tronWeb = getTronWeb();

    const tx = await tronWeb.transactionBuilder.sendTrx(
      input.toAddress,
      Number(input.amountSun),
      input.fromAddress,
    );

    const signed = await tronWeb.trx.sign(tx, input.privateKey);
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);

    return { txId: extractTxId(broadcast, signed.txID) };
  } catch (error) {
    throw normalizeTronError(error, { assetSymbol: "TRX", isToken: false });
  }
}

export async function sendTrc20(input: SendTrc20Input): Promise<SendTronResult> {
  assertValidRecipient(input.toAddress);

  if (input.amountBaseUnits <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  try {
    const tronWeb = getTronWeb();

    const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
      input.contractAddress,
      "transfer(address,uint256)",
      { feeLimit: input.feeLimitSun ?? TRC20_DEFAULT_FEE_LIMIT_SUN },
      [
        { type: "address", value: input.toAddress },
        { type: "uint256", value: input.amountBaseUnits.toString() },
      ],
      input.fromAddress,
    );

    if (!transaction) {
      throw new Error("Failed to build TRC-20 transfer.");
    }

    const signed = await tronWeb.trx.sign(transaction, input.privateKey);
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);

    // NOTE: USDT TRC-20 does not reliably return a boolean from transfer(); we
    // intentionally do NOT gate success on a return value. A successful
    // broadcast means "submitted" — final success is determined by polling.
    return { txId: extractTxId(broadcast, signed.txID) };
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
