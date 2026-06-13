// src/chains/solana/solana.transactions.ts
//
// Solana transaction building (native SOL transfer), status polling and activity
// loading. On-chain amounts are integer lamports (bigint).
//
// SECURITY: the signing secret key (Uint8Array) is passed in by the wallet
// service and used only with the local web3.js signer. It is never logged,
// persisted, or sent to the RPC provider. We do not echo raw signing errors.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getSolanaTransactionExplorerUrl,
  SOL_FEE_RESERVE_LAMPORTS,
  type SolanaChainConfig,
} from "./solana.config";
import { isValidSolanaAddress } from "./solana.address";
import {
  resolveHealthySolanaConnection,
  withSolanaRead,
} from "./solana.rpc";
import { normalizeSolanaError, solanaErrorFor } from "./solana.errors";
import type { SolanaActivityItem, SolanaSendResult } from "./solana.types";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";

// Binary-safe base64 → bytes (no reliance on a global Buffer polyfill).
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Broadcast an already-signed serialized Solana transaction --------------
//
// Used by the cross-chain (LI.FI) Solana-source path: the provider supplies a
// serialized transaction, the wallet signs it locally, and we submit the signed
// bytes to a healthy Solana RPC. We deliberately DO NOT rebuild the transaction
// (its blockhash + instructions come from the provider) and we never confirm
// across endpoints (which could double-send). The returned signature is tracked
// as "submitted"; final status comes from the gateway's /status endpoint.
export async function sendRawSolanaTransaction(params: {
  signedTransactionBase64: string;
  config: SolanaChainConfig;
}): Promise<SolanaSendResult> {
  let rawTx: Uint8Array;
  try {
    rawTx = base64ToBytes(params.signedTransactionBase64);
  } catch {
    throw solanaErrorFor(
      "BUILD_TX_FAILED",
      "Could not prepare this route. Try again.",
    );
  }

  const connection = await resolveHealthySolanaConnection(params.config);
  try {
    const signature = await connection.sendRawTransaction(rawTx, {
      maxRetries: 3,
    });
    return { signature };
  } catch (error) {
    throw normalizeSolanaError(error, "BROADCAST_FAILED");
  }
}

// --- Send native SOL -----------------------------------------------------

export type SendSolTransactionParams = {
  fromSecretKey: Uint8Array;
  toAddress: string;
  amountLamports: bigint;
  config: SolanaChainConfig;
};

// Validate, balance-check (leaving lamports for the fee), build a
// SystemProgram.transfer, sign locally and broadcast with confirmation.
// Returns the transaction signature.
//
// The broadcast endpoint is resolved up front via a health probe and then used
// for the WHOLE send — we never retry a broadcast across endpoints, which could
// double-send. Only the up-front read (health probe + balance) is fallback-safe.
export async function sendSolTransaction(
  params: SendSolTransactionParams,
): Promise<SolanaSendResult> {
  const { fromSecretKey, toAddress, amountLamports, config } = params;

  if (!isValidSolanaAddress(toAddress)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  if (amountLamports <= 0n) {
    throw solanaErrorFor("INVALID_AMOUNT");
  }

  let signer: Keypair;
  try {
    signer = Keypair.fromSecretKey(fromSecretKey);
  } catch {
    throw solanaErrorFor("SIGNING_FAILED");
  }

  const recipient = new PublicKey(toAddress);
  // Pick a known-good endpoint (rotates past 403/429/outage) and use it for the
  // whole send so the broadcast is never duplicated across endpoints.
  const connection = await resolveHealthySolanaConnection(config);

  let lamportsBalance: number;
  try {
    lamportsBalance = await connection.getBalance(signer.publicKey);
  } catch (error) {
    throw normalizeSolanaError(error);
  }

  // Keep a small reserve so the network fee is always covered.
  if (BigInt(lamportsBalance) < amountLamports + SOL_FEE_RESERVE_LAMPORTS) {
    throw solanaErrorFor("INSUFFICIENT_BALANCE");
  }

  let transaction: Transaction;
  try {
    transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: recipient,
        lamports: amountLamports,
      }),
    );
  } catch (error) {
    throw normalizeSolanaError(error, "BUILD_TX_FAILED");
  }

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [signer],
      { commitment: "confirmed" },
    );

    return { signature };
  } catch (error) {
    // Never echo the cause — it could embed key material.
    const normalized = normalizeSolanaError(error, "BROADCAST_FAILED");
    throw normalized;
  }
}

// --- Status --------------------------------------------------------------

export async function getSolanaTransactionStatus(
  config: SolanaChainConfig,
  signature: string,
): Promise<TransactionHistoryStatus> {
  try {
    const { value } = await withSolanaRead(config, (connection) =>
      connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      }),
    );

    if (!value) {
      // Not yet visible to the node — treat as still pending, not failed.
      return "submitted";
    }

    if (value.err) {
      return "failed";
    }

    if (
      value.confirmationStatus === "confirmed" ||
      value.confirmationStatus === "finalized"
    ) {
      return "confirmed";
    }

    return "submitted";
  } catch {
    return "submitted";
  }
}

// --- Activity ------------------------------------------------------------

function accountKeyToString(key: unknown): string {
  if (key instanceof PublicKey) {
    return key.toBase58();
  }

  const pubkey = (key as { pubkey?: unknown }).pubkey;
  if (pubkey instanceof PublicKey) {
    return pubkey.toBase58();
  }
  if (typeof pubkey === "string") {
    return pubkey;
  }

  return typeof key === "string" ? key : String(key ?? "");
}

// Load recent activity for `address`: fetch the latest signatures, then the
// parsed transactions, and compute the owner's net SOL delta per transaction to
// derive direction + amount. We intentionally do not classify SPL/DEX flows —
// the goal is a stable history, not perfect labelling.
export async function loadSolanaActivity(
  config: SolanaChainConfig,
  address: string,
  limit = 15,
): Promise<SolanaActivityItem[]> {
  if (!isValidSolanaAddress(address)) {
    return [];
  }

  // Fetch signatures + their parsed transactions on a SINGLE endpoint (with
  // fallback across endpoints) so both halves agree and a 403/429 rotates.
  const owner = new PublicKey(address);
  const { signatures, parsedTxs } = await withSolanaRead(
    config,
    async (connection) => {
      const sigs = await connection.getSignaturesForAddress(owner, { limit });
      if (sigs.length === 0) {
        return { signatures: sigs, parsedTxs: [] };
      }
      const txs = await connection.getParsedTransactions(
        sigs.map((entry) => entry.signature),
        { maxSupportedTransactionVersion: 0 },
      );
      return { signatures: sigs, parsedTxs: txs };
    },
  );

  if (signatures.length === 0) {
    return [];
  }

  const items: SolanaActivityItem[] = [];

  for (let index = 0; index < signatures.length; index += 1) {
    const sigInfo = signatures[index];
    const tx = parsedTxs[index];
    const explorerUrl = getSolanaTransactionExplorerUrl(
      config,
      sigInfo.signature,
    );

    const confirmed =
      sigInfo.confirmationStatus === "confirmed" ||
      sigInfo.confirmationStatus === "finalized";
    const blockTime = sigInfo.blockTime ?? tx?.blockTime ?? null;

    if (!tx || !tx.meta) {
      // Couldn't fetch details — still surface the signature as a generic entry.
      items.push({
        signature: sigInfo.signature,
        direction: "self",
        amountLamports: 0n,
        feeLamports: null,
        confirmed,
        blockTime,
        explorerUrl,
      });
      continue;
    }

    const keys = tx.transaction.message.accountKeys.map(accountKeyToString);
    const ownerIndex = keys.indexOf(address);
    const feeLamports = BigInt(tx.meta.fee ?? 0);

    let direction: SolanaActivityItem["direction"] = "self";
    let amountLamports = 0n;

    if (
      ownerIndex >= 0 &&
      tx.meta.preBalances[ownerIndex] != null &&
      tx.meta.postBalances[ownerIndex] != null
    ) {
      const pre = BigInt(tx.meta.preBalances[ownerIndex]);
      const post = BigInt(tx.meta.postBalances[ownerIndex]);
      const delta = post - pre;

      if (delta > 0n) {
        direction = "incoming";
        amountLamports = delta;
      } else if (delta < 0n) {
        direction = "outgoing";
        // The fee is bundled into the fee payer's negative delta; strip it so
        // the displayed amount is the transferred value, not value + fee.
        const magnitude = -delta;
        amountLamports = ownerIndex === 0 ? magnitude - feeLamports : magnitude;
        if (amountLamports < 0n) amountLamports = 0n;
      }
    }

    items.push({
      signature: sigInfo.signature,
      direction,
      amountLamports,
      feeLamports,
      confirmed,
      blockTime,
      explorerUrl,
    });
  }

  return items.sort((a, b) => {
    if (a.confirmed !== b.confirmed) {
      return a.confirmed ? 1 : -1; // pending first
    }
    return (b.blockTime ?? 0) - (a.blockTime ?? 0);
  });
}
