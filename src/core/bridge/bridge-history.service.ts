// src/core/bridge/bridge-history.service.ts
//
// Reconciles locally-recorded cross-chain bridge rows (direction "bridge") from
// pending → confirmed/failed WITHOUT requiring the user to stay on the success
// screen. Runs on the Activity page (load + refresh). Two independent signals,
// kept separate (see transaction-history.service granular fields):
//
//   • source-chain tx status — for Solana sources, HTTP getSignatureStatus
//     polling with multi-endpoint RPC fallback (never websocket-only), which
//     never fabricates "failed" on an RPC error.
//   • cross-chain provider status — the Simpl/LI.FI status endpoint, polled once
//     the source tx is (or was) confirmed.
//
// Status is monotonic (enforced in updateBridgeReconcile): a confirmed/completed
// row is never walked back to pending by a later transient/stale read.

import {
  transactionHistoryService,
  type TransactionHistoryItem,
} from "../transactions/transaction-history.service";
import {
  getBridgeStatus,
  LIFI_SOLANA_CHAIN_ID,
  LIFI_TRON_CHAIN_ID,
} from "./lifi-bridge.service";
import { getSolanaTransactionStatus } from "../../chains/solana/solana.transactions";
import { SOLANA_MAINNET } from "../../chains/solana/solana.config";
import { isBridgeDebugEnabled } from "../../chains/solana/solana.bridge";
import { getTronActivityStatus } from "../../chains/tron/tron.adapter";

// Dev-only, prefixed [bridge:history], behind the simpl.debug.bridge flag.
// Safe metadata only — tx hash (public), statuses, chain + provider names.
function historyDebugLog(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[bridge:history] ${event}`, data);
}

function isSolanaSourceBridge(item: TransactionHistoryItem): boolean {
  return (
    item.bridgeFromChainId === LIFI_SOLANA_CHAIN_ID ||
    item.chainId === LIFI_SOLANA_CHAIN_ID
  );
}

function isTronSourceBridge(item: TransactionHistoryItem): boolean {
  return (
    item.bridgeFromChainId === LIFI_TRON_CHAIN_ID ||
    item.chainId === LIFI_TRON_CHAIN_ID
  );
}

// Non-EVM (Solana/TRON) sources land asynchronously and we poll the source tx
// directly — so the cross-chain provider status should only be polled AFTER the
// source tx confirms (EVM sources are polled immediately by tx hash).
function isNonEvmSourceBridge(item: TransactionHistoryItem): boolean {
  return isSolanaSourceBridge(item) || isTronSourceBridge(item);
}

// True for bridge rows that aren't already in a terminal state.
function isReconcilable(item: TransactionHistoryItem): boolean {
  return (
    item.direction === "bridge" &&
    item.status !== "failed" &&
    item.status !== "confirmed" &&
    item.bridgeStatus !== "completed" &&
    item.bridgeStatus !== "failed"
  );
}

// Reconcile pending/in-progress bridge rows. Pass the current account's items to
// scope the work (falls back to all rows). Returns true if any row changed so
// the caller can re-render. Best-effort and resilient — individual failures
// never reject the whole pass and never downgrade a confirmed row.
export async function reconcilePendingBridgeTransactions(
  items?: TransactionHistoryItem[],
): Promise<boolean> {
  const pending = (items ?? transactionHistoryService.list()).filter(
    isReconcilable,
  );
  if (pending.length === 0) return false;

  historyDebugLog("reconcile-start", { count: pending.length });

  const results = await Promise.allSettled(
    pending.map(async (item) => {
      // 1) Source-chain tx status. Solana → resilient HTTP getSignatureStatus
      // polling; TRON → TronGrid getTransactionInfo (both never fabricate a
      // "failed" on a transient RPC error — they report "submitted"/"pending").
      let sourceTxStatus: "submitted" | "confirmed" | "failed" =
        item.bridgeSourceTxStatus ?? "submitted";
      if (sourceTxStatus !== "confirmed" && sourceTxStatus !== "failed") {
        if (isSolanaSourceBridge(item)) {
          sourceTxStatus = await getSolanaTransactionStatus(
            SOLANA_MAINNET,
            item.hash,
          );
          historyDebugLog("source-status", {
            hash: item.hash,
            chain: item.bridgeFromChainName ?? item.chainName,
            old: item.bridgeSourceTxStatus ?? "submitted",
            new: sourceTxStatus,
          });
        } else if (isTronSourceBridge(item)) {
          sourceTxStatus = await getTronActivityStatus(item.hash);
          historyDebugLog("source-status", {
            hash: item.hash,
            chain: item.bridgeFromChainName ?? item.chainName,
            old: item.bridgeSourceTxStatus ?? "submitted",
            new: sourceTxStatus,
          });
        }
      }

      // 2) Cross-chain provider status. For Solana sources we wait until the
      // source tx is confirmed (avoids polling before it lands); for EVM sources
      // we poll directly (LI.FI resolves by tx hash + chains).
      let bridgeStatus: "pending" | "completed" | "failed" | "unknown" =
        item.bridgeStatus ?? "pending";
      const shouldPollProvider =
        bridgeStatus !== "completed" &&
        bridgeStatus !== "failed" &&
        (!isNonEvmSourceBridge(item) || sourceTxStatus === "confirmed");
      if (shouldPollProvider) {
        try {
          const res = await getBridgeStatus({
            txHash: item.hash,
            fromChainId: item.bridgeFromChainId ?? item.chainId,
            toChainId: item.bridgeToChainId ?? item.chainId,
          });
          bridgeStatus =
            res.status === "DONE"
              ? "completed"
              : res.status === "FAILED"
                ? "failed"
                : res.status === "NOT_FOUND"
                  ? "unknown"
                  : "pending";
          historyDebugLog("provider-status", {
            hash: item.hash,
            provider: item.bridgeProvider,
            old: item.bridgeStatus ?? "pending",
            new: bridgeStatus,
          });
        } catch {
          // Provider endpoint unavailable — keep the prior bridge status; the
          // source-confirmed signal still drives the "In progress" badge.
          historyDebugLog("provider-status", {
            hash: item.hash,
            provider: item.bridgeProvider,
            old: item.bridgeStatus ?? "pending",
            new: "unknown (provider unavailable)",
          });
        }
      }

      const updated = transactionHistoryService.updateBridgeReconcile({
        chainId: item.chainId,
        hash: item.hash,
        sourceTxStatus,
        bridgeStatus,
      });

      const changed =
        updated != null &&
        (updated.status !== item.status ||
          updated.bridgeSourceTxStatus !== item.bridgeSourceTxStatus ||
          updated.bridgeStatus !== item.bridgeStatus);
      if (changed) {
        historyDebugLog("updated", {
          hash: item.hash,
          oldStatus: item.status,
          newStatus: updated?.status,
          sourceTxStatus: updated?.bridgeSourceTxStatus,
          bridgeStatus: updated?.bridgeStatus,
          chain: item.bridgeFromChainName ?? item.chainName,
          provider: item.bridgeProvider,
        });
      }
      return changed;
    }),
  );

  return results.some((r) => r.status === "fulfilled" && r.value === true);
}
