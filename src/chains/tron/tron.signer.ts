// src/chains/tron/tron.signer.ts
//
// Low-level TRON signing primitives: build an unsigned transaction, sign it with
// a private key, and broadcast the signed transaction.
//
// SECURITY: signing happens here, inside the wallet/background service layer.
// The private key is supplied by the wallet service (derived from the encrypted
// vault) and never crosses into the React UI, logs, storage, or network requests
// other than the signed broadcast itself.
//   - The shared TronWeb instance is created WITHOUT a private key (see
//     tron.balance.ts getTronWeb); we never set a default signing key on it.
//   - We never log the private key or the unsigned/signed transaction.
//   - We never return the private key.

import type { Types } from "tronweb";
import { getTronWeb } from "./tron.balance";
import { tronError, normalizeTronError } from "./tron.errors";

export type UnsignedTronTransaction = Types.Transaction;
export type SignedTronTransaction = Types.SignedTransaction;

export type TronBroadcastResult = {
  txId: string;
};

// Classify a transaction-build failure. Prefer a specific cause (insufficient
// balance, network) when TronGrid's validation surfaced one; otherwise fall back
// to the generic TRON_BUILD_TX_FAILED code.
function asBuildError(
  error: unknown,
  context?: { assetSymbol?: string; isToken?: boolean },
): Error {
  const normalized = normalizeTronError(error, context);

  if (normalized.code === "TRON_TX_FAILED") {
    return tronError("TRON_BUILD_TX_FAILED", "Could not build the transaction.");
  }

  return normalized;
}

export type SendTrxTransactionInput = {
  fromAddress: string;
  toAddress: string;
  // Amount in sun (1 TRX = 1_000_000 sun). bigint to avoid float precision bugs.
  amountSun: bigint;
  privateKey: string;
};

// Sign an already-built unsigned transaction with the given private key. The key
// is passed only to TronWeb's local signer and is never logged or persisted.
export async function signTronTransaction(
  unsignedTx: UnsignedTronTransaction,
  privateKey: string,
): Promise<SignedTronTransaction> {
  try {
    const tronWeb = getTronWeb();
    return (await tronWeb.trx.sign(unsignedTx, privateKey)) as SignedTronTransaction;
  } catch (error) {
    // Local signing failure (e.g. malformed key/tx). Do not echo the cause —
    // it could embed sensitive material.
    throw tronError("TRON_SIGN_REJECTED", "Could not sign the transaction.");
  }
}

// Broadcast a signed transaction. TronGrid acknowledges a submitted tx with
// { result: true, txid }, or returns a failure object whose message may be
// hex-encoded — normalizeTronError decodes and classifies it.
export async function sendSignedTronTransaction(
  signedTx: SignedTronTransaction,
): Promise<TronBroadcastResult> {
  try {
    const tronWeb = getTronWeb();
    const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);

    const record = (broadcast ?? {}) as unknown as {
      result?: boolean;
      txid?: string;
      code?: unknown;
      message?: string;
    };

    if (record.result === true || typeof record.txid === "string") {
      return { txId: record.txid ?? signedTx.txID };
    }

    throw normalizeTronError(record.message ?? record.code ?? record);
  } catch (error) {
    if ((error as { code?: string })?.code) {
      // Already a coded TronError from the failure-object path above.
      throw error;
    }
    throw normalizeTronError(error);
  }
}

// Build, sign and broadcast a native TRX transfer end to end.
export async function sendTrxTransaction(
  input: SendTrxTransactionInput,
): Promise<TronBroadcastResult> {
  if (input.amountSun <= 0n) {
    throw tronError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  let unsignedTx: UnsignedTronTransaction;

  try {
    const tronWeb = getTronWeb();
    unsignedTx = await tronWeb.transactionBuilder.sendTrx(
      input.toAddress,
      // TronWeb's builder takes a JS number of sun; amounts are well within
      // Number's safe-integer range for any realistic TRX transfer.
      Number(input.amountSun),
      input.fromAddress,
    );
  } catch (error) {
    throw asBuildError(error, { assetSymbol: "TRX", isToken: false });
  }

  const signedTx = await signTronTransaction(unsignedTx, input.privateKey);
  return sendSignedTronTransaction(signedTx);
}
