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
import { reconcilePendingBridgeTransactions } from "../../core/bridge/bridge-history.service";
import { t, useTranslation } from "../../i18n";

type TransactionHistoryPageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onBack: () => void;
  onViewTransaction: (item: TransactionHistoryItem) => void;
};

// ── Icons ──────────────────────────────────────────────────────────

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12a8 8 0 1 0 2.3-5.7" />
      <path d="M4 5v5h5" />
    </svg>
  );
}

function SendArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function ReceiveArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 7L7 17" />
      <path d="M15 17H7V9" />
    </svg>
  );
}

function SwapArrowsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 7h10l-3-3" />
      <path d="M17 17H7l3 3" />
    </svg>
  );
}

function FailedXIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}

function ClockEmptyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </svg>
  );
}

// ── Formatters ─────────────────────────────────────────────────────

function shortAddress(address: string): string {
  if (!address || address.length <= 12) return address || "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
}

function formatAmount(value: string | null | undefined): string {
  if (!value) return "—";
  const n = Number(value.trim());
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return "<0.000001";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

// ── Row helpers ────────────────────────────────────────────────────

function getRowTitle(item: TransactionHistoryItem): string {
  if (item.direction === "bridge") {
    return t("activity.bridgeTitle", {
      from: item.bridgeFromSymbol ?? item.swapFromSymbol ?? "Token",
      fromChain: item.bridgeFromChainName ?? "",
      toChain: item.bridgeToChainName ?? "",
    }).trim();
  }
  if (item.direction === "swap") {
    return t("activity.swappedTitle", {
      from: item.swapFromSymbol ?? "Token",
      to: item.swapToSymbol ?? "Token",
    });
  }
  if (item.direction === "receive")
    return t("activity.receivedTitle", { symbol: item.assetSymbol });
  return t("activity.sentTitle", { symbol: item.assetSymbol });
}

function getRowSecondary(item: TransactionHistoryItem): string {
  const ts = formatTimestamp(item.createdAt);
  const net = item.chainName || "";
  if (item.direction === "bridge") {
    const route =
      item.bridgeProvider != null
        ? t("activity.viaProvider", { provider: item.bridgeProvider })
        : "";
    return [route, ts].filter(Boolean).join(" · ");
  }
  if (item.direction === "swap") {
    return [net, ts].filter(Boolean).join(" · ");
  }
  if (item.direction === "receive") {
    return [
      t("activity.fromAddress", { address: shortAddress(item.fromAddress) }),
      net,
      ts,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    t("activity.toAddress", { address: shortAddress(item.toAddress) }),
    net,
    ts,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getRowAmount(item: TransactionHistoryItem): string {
  if (item.direction === "bridge") {
    const from = formatAmount(item.bridgeFromAmount ?? item.amount);
    const sym = item.bridgeFromSymbol ?? item.assetSymbol;
    return `${from} ${sym}`;
  }
  if (item.direction === "swap") {
    const from = formatAmount(item.swapFromAmount ?? item.amount);
    const sym = item.swapFromSymbol ?? item.assetSymbol;
    return `${from} ${sym}`;
  }
  const sign = item.direction === "receive" ? "+" : "-";
  return `${sign}${item.amount}`;
}

function getIconVariant(item: TransactionHistoryItem): "send" | "receive" | "swap" | "failed" {
  if (item.status === "failed") return "failed";
  // Bridges reuse the swap (cross-arrows) glyph — both move one asset to another.
  if (item.direction === "swap" || item.direction === "bridge") return "swap";
  if (item.direction === "receive") return "receive";
  return "send";
}

function getStatusLabel(status: string): string {
  if (status === "confirmed") return t("activity.status.confirmed");
  if (status === "failed") return t("activity.status.failed");
  return t("activity.status.pending");
}

// Bridge rows use the granular source/bridge statuses so a finalized source tx
// never reads as a bare "Pending": source-confirmed-but-not-completed shows
// "In progress". `variant` maps to the existing badge CSS classes.
function getBridgeBadge(item: TransactionHistoryItem): {
  label: string;
  variant: "submitted" | "confirmed" | "failed";
} {
  if (
    item.status === "failed" ||
    item.bridgeStatus === "failed" ||
    item.bridgeSourceTxStatus === "failed"
  ) {
    return { label: t("activity.status.failed"), variant: "failed" };
  }
  if (item.bridgeStatus === "completed" || item.status === "confirmed") {
    return { label: t("activity.status.completed"), variant: "confirmed" };
  }
  if (item.bridgeSourceTxStatus === "confirmed") {
    return { label: t("activity.status.inProgress"), variant: "submitted" };
  }
  return { label: t("activity.status.pending"), variant: "submitted" };
}

// ── Date grouping ──────────────────────────────────────────────────

type DateGroup = { label: string; items: TransactionHistoryItem[] };

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function groupByDate(items: TransactionHistoryItem[]): DateGroup[] {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: DateGroup[] = [
    { label: t("activity.dateToday"), items: [] },
    { label: t("activity.dateYesterday"), items: [] },
    { label: t("activity.dateEarlier"), items: [] },
  ];

  for (const item of items) {
    const d = new Date(item.createdAt);
    if (!Number.isNaN(d.getTime()) && isSameDay(d, now)) {
      groups[0].items.push(item);
    } else if (!Number.isNaN(d.getTime()) && isSameDay(d, yesterday)) {
      groups[1].items.push(item);
    } else {
      groups[2].items.push(item);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

// ── Sub-components ─────────────────────────────────────────────────

function TxIcon({ variant }: { variant: "send" | "receive" | "swap" | "failed" }) {
  return (
    <div className={`activity-icon activity-icon--${variant}`}>
      {variant === "send" && <SendArrowIcon />}
      {variant === "receive" && <ReceiveArrowIcon />}
      {variant === "swap" && <SwapArrowsIcon />}
      {variant === "failed" && <FailedXIcon />}
    </div>
  );
}

function TxRow({
  item,
  onClick,
}: {
  item: TransactionHistoryItem;
  onClick: (item: TransactionHistoryItem) => void;
}) {
  const variant = getIconVariant(item);

  return (
    <button type="button" className="activity-row" onClick={() => onClick(item)}>
      <TxIcon variant={variant} />

      <div className="activity-body">
        <div className="activity-primary">{getRowTitle(item)}</div>
        <div className="activity-secondary">{getRowSecondary(item)}</div>
      </div>

      <div className="activity-right">
        <span
          className={`activity-amount${item.direction === "receive" ? " activity-amount--receive" : ""}`}
        >
          {getRowAmount(item)}
        </span>
        {(() => {
          const badge =
            item.direction === "bridge"
              ? getBridgeBadge(item)
              : { label: getStatusLabel(item.status), variant: item.status };
          return (
            <span className={`activity-badge activity-badge--${badge.variant}`}>
              {badge.label}
            </span>
          );
        })()}
      </div>
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export function TransactionHistoryPage({
  selectedAccount,
  walletState,
  onBack,
  onViewTransaction,
}: TransactionHistoryPageProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TransactionHistoryItem[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  async function refresh() {
    if (!selectedAccount) {
      setItems([]);
      return;
    }

    const bitcoinAddresses =
      "bitcoinAddresses" in selectedAccount && selectedAccount.bitcoinAddresses
        ? Object.values(selectedAccount.bitcoinAddresses).flatMap((pair) => [
            pair.receive,
            pair.change,
          ])
        : [];

    const accountAddresses = [
      selectedAccount.address,
      "tronAddress" in selectedAccount ? selectedAccount.tronAddress : null,
      "solanaAddress" in selectedAccount ? selectedAccount.solanaAddress : null,
      ...bitcoinAddresses,
    ];

    const currentItems =
      transactionHistoryService.listByAddresses(accountAddresses);
    setItems(currentItems);

    const submittedItems = currentItems.filter(
      (item) =>
        item.chainId === walletState.selectedChainId &&
        item.status === "submitted",
    );

    if (submittedItems.length > 0) {
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
    }

    // Reconcile cross-chain bridge rows (source-chain confirmation + provider
    // status) independent of the selected network — Solana source status via
    // resilient HTTP polling. Best-effort; never blocks the rest of the refresh.
    try {
      await reconcilePendingBridgeTransactions(currentItems);
    } catch {
      // ignore — reconciliation is best-effort and retried on next refresh.
    }

    const localItems =
      transactionHistoryService.listByAddresses(accountAddresses);

    // Bitcoin + Solana: merge live on-chain activity (incoming + outgoing) with
    // any locally recorded sends, de-duplicating by id and preferring the live
    // entry (it carries confirmation status + block time). Each call is for the
    // currently selected network only and returns [] off-network or on failure.
    let liveItems: TransactionHistoryItem[] = [];
    try {
      const [bitcoin, solana] = await Promise.all([
        walletService.getSelectedBitcoinActivity().catch(() => []),
        walletService.getSelectedSolanaActivity().catch(() => []),
      ]);
      liveItems = [...bitcoin, ...solana];
    } catch {
      liveItems = [];
    }

    if (liveItems.length === 0) {
      setItems(localItems);
      return;
    }

    // A swap shows up on-chain as a plain transfer under the same signature as
    // our local "Swapped A → B" entry. Keep the richer local swap row (so it
    // doesn't collapse to a bare "Sent SOL"), but adopt the live confirmation
    // status when the matching on-chain entry is available. Non-swap local
    // entries are still superseded by their live counterpart as before.
    const liveById = new Map(liveItems.map((item) => [item.id, item]));
    const localSwapIds = new Set(
      localItems
        .filter((item) => item.direction === "swap")
        .map((item) => item.id),
    );

    const merged = [
      ...liveItems.filter((item) => !localSwapIds.has(item.id)),
      ...localItems
        .filter((item) => item.direction === "swap" || !liveById.has(item.id))
        .map((item) => {
          if (item.direction !== "swap") return item;
          const live = liveById.get(item.id);
          return live && live.status !== item.status
            ? { ...item, status: live.status }
            : item;
        }),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    setItems(merged);
  }

  useEffect(() => {
    void refresh();
  }, [selectedAccount?.address, walletState.selectedChainId]);

  function executeClearHistory() {
    if (!selectedAccount) {
      setConfirmClearOpen(false);
      return;
    }
    const bitcoinAddresses =
      "bitcoinAddresses" in selectedAccount && selectedAccount.bitcoinAddresses
        ? Object.values(selectedAccount.bitcoinAddresses).flatMap((pair) => [
            pair.receive,
            pair.change,
          ])
        : [];

    transactionHistoryService.clearByAddresses([
      selectedAccount.address,
      "tronAddress" in selectedAccount ? selectedAccount.tronAddress : null,
      "solanaAddress" in selectedAccount ? selectedAccount.solanaAddress : null,
      ...bitcoinAddresses,
    ]);
    setConfirmClearOpen(false);
    void refresh();
  }

  const groups = groupByDate(items);

  return (
    <div className="ext-popup" data-screen-label="09 Activity">
      {/* Header */}
      <div className="bar-top">
        <button
          className="icbtn"
          type="button"
          onClick={onBack}
          aria-label={t("common.back")}
        >
          <BackIcon />
        </button>
        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {t("activity.title")}
        </div>
        <span style={{ flex: 1 }} />
        <button
          className="icbtn"
          type="button"
          onClick={() => void refresh()}
          aria-label={t("common.refresh")}
        >
          <RefreshIcon />
        </button>
      </div>

      {/* Body */}
      <div className="screen-body">
        <div className="activity-intro">
          <div className="activity-intro-title">
            {t("activity.transactionHistory")}
          </div>
          <div className="activity-intro-subtitle">
            {t("activity.subtitle")}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="activity-empty">
            <div className="activity-empty-icon">
              <ClockEmptyIcon />
            </div>
            <div className="activity-empty-title">{t("activity.emptyTitle")}</div>
            <div className="activity-empty-text">
              {t("activity.emptyBody")}
            </div>
            <button
              type="button"
              className="btn secondary lg"
              onClick={onBack}
            >
              {t("common.backToWallet")}
            </button>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.label}>
                <div className="activity-date-label">{group.label}</div>
                {group.items.map((item) => (
                  <TxRow
                    key={item.id}
                    item={item}
                    onClick={onViewTransaction}
                  />
                ))}
              </div>
            ))}

            <button
              type="button"
              className="btn secondary lg full"
              onClick={() => setConfirmClearOpen(true)}
              style={{ marginTop: 16 }}
            >
              {t("activity.clearHistory")}
            </button>
          </>
        )}
      </div>

      {/* Confirm clear */}
      {confirmClearOpen ? (
        <div
          role="presentation"
          onClick={() => setConfirmClearOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "grid",
            alignItems: "end",
            background: "rgba(0, 0, 0, 0.24)",
            padding: "0 12px 16px",
            boxSizing: "border-box",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("activity.clearConfirmLabel")}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 24,
                background: "var(--bg-surface)",
                boxShadow: "0 24px 80px rgba(0, 0, 0, 0.18)",
                padding: 18,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 850,
                  letterSpacing: "-0.02em",
                  color: "var(--ink-1)",
                }}
              >
                {t("activity.clearConfirmTitle")}
              </div>
              <p
                style={{
                  margin: "8px 0 0",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                This removes local transaction history for the selected account.
                On-chain transactions will still be visible in explorers.
              </p>
              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  className="btn primary lg full"
                  onClick={executeClearHistory}
                  style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
                >
                  {t("activity.clearConfirm")}
                </button>
                <button
                  type="button"
                  className="btn secondary lg full"
                  onClick={() => setConfirmClearOpen(false)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default TransactionHistoryPage;
