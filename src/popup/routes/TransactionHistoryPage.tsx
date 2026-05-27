// src/popup/routes/TransactionHistoryPage.tsx

import { useEffect, useState } from "react";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import "./TransactionHistoryPage.css";
import {
  transactionHistoryService,
  type TransactionHistoryItem,
} from "../../core/transactions/transaction-history.service";

type TransactionHistoryPageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onBack: () => void;
};

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" />
      <path d="M12 8v5l3 2" fill="none" stroke="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17L17 7" fill="none" stroke="currentColor" />
      <path d="M9 7h8v8" fill="none" stroke="currentColor" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10l-3-3" fill="none" stroke="currentColor" />
      <path d="M17 17H7l3 3" fill="none" stroke="currentColor" />
      <path d="M17 7l-3 3" fill="none" stroke="currentColor" />
      <path d="M7 17l3-3" fill="none" stroke="currentColor" />
    </svg>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}


function formatHistoryShortHash(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatTransactionDetailValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

function formatTransactionDetailRoute(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return value
    .replace(/_CL$/u, "")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getTransactionDetailTitle(item: TransactionHistoryItem): string {
  if (item.swapFromSymbol && item.swapToSymbol) {
    return `Swapped ${item.swapFromSymbol} → ${item.swapToSymbol}`;
  }

  return getTransactionTitle(item);
}

function getTransactionDetailAmount(item: TransactionHistoryItem): string {
  if (
    item.swapFromAmount &&
    item.swapFromSymbol &&
    item.swapToAmount &&
    item.swapToSymbol
  ) {
    return `${item.swapFromAmount} ${item.swapFromSymbol} → ${item.swapToAmount} ${item.swapToSymbol}`;
  }

  return formatTransactionDetailValue(item.amount);
}

function formatTransactionDetailStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function getTransactionDetailStatusClass(
  value: string | null | undefined,
): string {
  const normalized = String(value ?? "").toLowerCase();

  if (normalized.includes("confirm") || normalized.includes("success")) {
    return "confirmed";
  }

  if (normalized.includes("fail") || normalized.includes("error")) {
    return "failed";
  }

  return "pending";
}

function TransactionRow({ item }: { item: TransactionHistoryItem }) {
  const content = (
    <div className="row tx-row">
      <div className="tok">
        {item.direction === "swap" ? <SwapIcon /> : <SendIcon />}
      </div>

      <div className="body">
        <div className="nm">{getTransactionTitle(item)}</div>

        {item.direction === "swap" ? (
          <>
            <div className="sub tx-swap-amount">
              {getTransactionAmountText(item)}
            </div>

            <div className="sub">
              {shortAddress(item.fromAddress)} → {shortAddress(item.toAddress)}
            </div>
          </>
        ) : (
          <div className="sub">
            {shortAddress(item.fromAddress)} → {shortAddress(item.toAddress)}
          </div>
        )}

        <div className="tx-meta">
          {item.chainName} · {getTransactionStatusText(item)} · {formatDate(item.createdAt)}
        </div>
        {hasSwapHistoryDetails(item) ? (
          <div className="transaction-history-swap-details">
            {item.swapRoute ? (
              <span>
                <strong>Route</strong>
                {item.swapRoute}
              </span>
            ) : null}

            {item.swapSimpleFee ? (
              <span>
                <strong>Fee</strong>
                {item.swapSimpleFee}
              </span>
            ) : null}

            {item.swapSlippage ? (
              <span>
                <strong>Slippage</strong>
                {item.swapSlippage}
              </span>
            ) : null}

            {item.swapMinimumReceived ? (
              <span>
                <strong>Min</strong>
                {item.swapMinimumReceived}
              </span>
            ) : null}

            {item.swapNetworkFee ? (
              <span>
                <strong>Network</strong>
                {item.swapNetworkFee}
              </span>
            ) : null}

            {item.explorerUrl ? (
              <a
                className="transaction-history-tx-link"
                href={item.explorerUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <strong>Tx</strong>
                {formatHistoryShortHash(item.hash)}
              </a>
            ) : (
              <span>
                <strong>Tx</strong>
                {formatHistoryShortHash(item.hash)}
              </span>
            )}
          </div>
        ) : null}
      </div>

      <div
        className="num tx-num"
        style={{
          minWidth: item.direction === "swap" ? 96 : undefined,
          maxWidth: item.direction === "swap" ? 120 : undefined,
        }}
      >
        <div className="v">
          {item.direction === "swap"
            ? getTransactionStatusText(item)
            : getTransactionAmountText(item)}
        </div>

        <div className="q">
          {item.direction === "swap" ? "Swap" : item.assetSymbol}
        </div>
      </div>
    </div>
  );

  if (!item.explorerUrl) {
    return content;
  }

  return (
    <a
      className="tx-link"
      href={item.explorerUrl}
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  );
}


function getTransactionTitle(item: TransactionHistoryItem): string {
  if (item.direction === "swap") {
    const fromSymbol = item.swapFromSymbol ?? "Token";
    const toSymbol = item.swapToSymbol ?? "Token";

    return `Swapped ${fromSymbol} → ${toSymbol}`;
  }

  if (item.direction === "receive") {
    return `Received ${item.assetSymbol}`;
  }

  return `Sent ${item.assetSymbol}`;
}

function getTransactionStatusText(item: TransactionHistoryItem): string {
  if (item.status === "confirmed") return "Confirmed";
  if (item.status === "failed") return "Failed";
  return "Submitted";
}

function formatHistoryAmount(value: string): string {
  const normalized = value.trim();

  if (!normalized) return value;

  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  if (numericValue === 0) return "0";

  if (Math.abs(numericValue) < 0.000001) {
    return "<0.000001";
  }

  return numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

function getTransactionAmountText(item: TransactionHistoryItem): string {
  if (item.direction === "swap") {
    const fromAmount = formatHistoryAmount(item.swapFromAmount ?? item.amount);
    const fromSymbol = item.swapFromSymbol ?? "";
    const toAmount = item.swapToAmount ? formatHistoryAmount(item.swapToAmount) : "";
    const toSymbol = item.swapToSymbol ?? "";

    if (toAmount && toSymbol) {
      return `${fromAmount} ${fromSymbol} → ${toAmount} ${toSymbol}`.trim();
    }

    return `${fromAmount} ${fromSymbol}`.trim();
  }

  const sign = item.direction === "receive" ? "+" : "-";

  return `${sign}${item.amount}`;
}




function hasSwapHistoryDetails(item: {
  direction?: string;
  assetType?: string;
  swapRoute?: string;
  swapSimpleFee?: string;
  swapNetworkFee?: string;
  swapSlippage?: string;
  swapMinimumReceived?: string;
  hash?: string | null;
}): boolean {
  return (
    item.direction === "swap" ||
    item.assetType === "swap" ||
    Boolean(
      item.swapRoute ||
        item.swapSimpleFee ||
        item.swapNetworkFee ||
        item.swapSlippage ||
        item.swapMinimumReceived,
    )
  );
}

export function TransactionHistoryPage({
  selectedAccount,
  walletState,
  onBack,
}: TransactionHistoryPageProps) {
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionHistoryItem | null>(null);

  const [items, setItems] = useState<TransactionHistoryItem[]>([]);

  async function refresh() {
    if (!selectedAccount) {
      setItems([]);
      return;
    }

    const currentItems = transactionHistoryService.listByAccount(
      selectedAccount.address,
    );

    setItems(currentItems);

    const submittedItems = currentItems.filter((item) => {
      return (
        item.chainId === walletState.selectedChainId &&
        item.status === "submitted"
      );
    });

    if (submittedItems.length === 0) {
      return;
    }

    await Promise.allSettled(
      submittedItems.map(async (item) => {
        const status = await walletService.getSelectedTransactionStatus({
          hash: item.hash,
        });

        if (status !== item.status) {
          transactionHistoryService.updateStatus({
            chainId: item.chainId,
            hash: item.hash,
            status,
          });
        }
      }),
    );

    setItems(transactionHistoryService.listByAccount(selectedAccount.address));
  }

  useEffect(() => {
    void refresh();
  }, [selectedAccount?.address, walletState.selectedChainId]);

  function clearHistory() {
    if (!selectedAccount) return;

    const confirmed = window.confirm(
      "Clear local transaction history for this account?",
    );

    if (!confirmed) return;

    transactionHistoryService.clearByAccount(selectedAccount.address);
    void refresh();
  }

  return (
    <div className="ext-popup" data-screen-label="09 Activity">
      <div className="bar-top activity-topbar">
        <button
          className="icbtn activity-topbar-back"
          type="button"
          onClick={onBack}
          aria-label="Back"
        >
          <BackIcon />
        </button>

        <div className="activity-topbar-title">Activity</div>

        <button
          className="icbtn activity-topbar-refresh"
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh transaction history"
        >
          <ClockIcon />
        </button>
      </div>

      <div className="screen-body">
        <section style={{ padding: "18px 16px 12px" }}>
          <div className="t-h2">
            Transaction
            <br />
            history
          </div>

          <p
            style={{
              margin: "10px 0 0",
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Local history of transactions sent from SIMPLE.
          </p>
        </section>

        <section style={{ padding: "0 12px 16px" }}>
          {items.length > 0 ? (
            <div className="row-list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="transaction-history-clickable-row"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedTransaction(item);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedTransaction(item);
                    }
                  }}
                >
                  <TransactionRow item={item} />
                </div>
              ))}
            </div>
          ) : (
            <section className="tx-empty">
              <div className="tok">
                <ClockIcon />
              </div>

              <div>
                <strong>No transactions yet</strong>
                <span>
                  Transactions sent from SIMPLE will appear here after
                  submission.
                </span>
              </div>
            </section>
          )}

          {items.length > 0 ? (
            <button
              type="button"
              className="btn secondary lg full"
              onClick={clearHistory}
              style={{ marginTop: 12 }}
            >
              Clear local history
            </button>
          ) : null}
        </section>
      </div>

      {selectedTransaction ? (
        <div
          className="transaction-detail-backdrop"
          role="presentation"
          onClick={() => setSelectedTransaction(null)}
        >
          <section
            className="transaction-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Transaction details"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="transaction-detail-header">
              <div>
                <p>Transaction details</p>
                <h2>{getTransactionDetailTitle(selectedTransaction)}</h2>
              </div>

              <button
                type="button"
                className="transaction-detail-close"
                onClick={() => setSelectedTransaction(null)}
                aria-label="Close transaction details"
              >
                ×
              </button>
            </div>

            <div className="transaction-detail-summary">
              <div className="transaction-detail-icon">⇄</div>
              <div>
                <strong>{getTransactionDetailAmount(selectedTransaction)}</strong>
                <p>
                  {formatTransactionDetailValue(selectedTransaction.chainName)} ·{" "}
                  {formatTransactionDetailStatus(selectedTransaction.status)}
                </p>
              </div>
            </div>

            <div className="transaction-detail-grid">
              <div className="transaction-detail-row">
                <span>Status</span>
                <strong
                  className={`transaction-detail-status transaction-detail-status--${getTransactionDetailStatusClass(
                    selectedTransaction.status,
                  )}`}
                >
                  {formatTransactionDetailStatus(selectedTransaction.status)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>Route</span>
                <strong>
                  {formatTransactionDetailRoute(selectedTransaction.swapRoute)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>Simple fee</span>
                <strong>
                  {formatTransactionDetailValue(selectedTransaction.swapSimpleFee)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>Network fee</span>
                <strong>
                  {formatTransactionDetailValue(selectedTransaction.swapNetworkFee)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>Slippage</span>
                <strong>
                  {formatTransactionDetailValue(selectedTransaction.swapSlippage)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>Minimum received</span>
                <strong>
                  {formatTransactionDetailValue(
                    selectedTransaction.swapMinimumReceived,
                  )}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>From</span>
                <strong className="transaction-detail-mono">
                  {formatHistoryShortHash(selectedTransaction.fromAddress)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>To</span>
                <strong className="transaction-detail-mono">
                  {formatHistoryShortHash(selectedTransaction.toAddress)}
                </strong>
              </div>

              <div className="transaction-detail-row">
                <span>Tx hash</span>
                <strong className="transaction-detail-mono">
                  {formatHistoryShortHash(selectedTransaction.hash)}
                </strong>
              </div>
            </div>

            <div className="transaction-detail-actions">
              {selectedTransaction.explorerUrl ? (
                <a
                  className="transaction-detail-secondary"
                  href={selectedTransaction.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on explorer
                </a>
              ) : null}

              <button
                type="button"
                className="transaction-detail-primary"
                onClick={() => setSelectedTransaction(null)}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default TransactionHistoryPage;
