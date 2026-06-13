// src/popup/routes/TransactionDetailsPage.tsx

import { useState } from "react";
import type { TransactionHistoryItem } from "../../core/transactions/transaction-history.service";
import "./TransactionDetailsPage.css";

type TransactionDetailsPageProps = {
  item: TransactionHistoryItem | null;
  onBack: () => void;
};

// ── Icons ───────────────────────────────────────────────────────────

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

// ── Formatters ──────────────────────────────────────────────────────

function shortAddress(address: string): string {
  if (!address || address.length <= 12) return address || "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function shortHash(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
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
  const abs = Math.abs(n);
  if (abs < 0.000001) return "<0.000001";
  return abs.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatDetailValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

function formatRoute(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_CL$/u, "")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// ── Helpers ─────────────────────────────────────────────────────────

type IconVariant = "send" | "receive" | "swap" | "failed";

function getIconVariant(item: TransactionHistoryItem): IconVariant {
  if (item.status === "failed") return "failed";
  if (item.direction === "swap" || item.direction === "bridge") return "swap";
  if (item.direction === "receive") return "receive";
  return "send";
}

function getPageTitle(item: TransactionHistoryItem): string {
  if (item.direction === "bridge") {
    return `Cross-chain swap ${
      item.bridgeFromSymbol ?? item.swapFromSymbol ?? "Token"
    } ${item.bridgeFromChainName ?? ""} → ${
      item.bridgeToChainName ?? ""
    }`.trim();
  }
  if (item.direction === "swap") {
    return `Swapped ${item.swapFromSymbol ?? "Token"} → ${item.swapToSymbol ?? "Token"}`;
  }
  if (item.direction === "receive") return `Received ${item.assetSymbol}`;
  return `Sent ${item.assetSymbol}`;
}

function getStatusLabel(status: string): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "failed") return "Failed";
  return "Pending";
}

// ── Sub-components ───────────────────────────────────────────────────

function TxIconLarge({ variant }: { variant: IconVariant }) {
  return (
    <div className={`txd-hero-icon txd-hero-icon--${variant}`}>
      {variant === "send" && <SendArrowIcon />}
      {variant === "receive" && <ReceiveArrowIcon />}
      {variant === "swap" && <SwapArrowsIcon />}
      {variant === "failed" && <FailedXIcon />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`txd-status txd-status--${status}`}>
      {getStatusLabel(status)}
    </span>
  );
}

// ── Main page ───────────────────────────────────────────────────────

export function TransactionDetailsPage({
  item,
  onBack,
}: TransactionDetailsPageProps) {
  const [copiedHash, setCopiedHash] = useState(false);

  async function copyHash() {
    if (!item?.hash) return;
    try {
      await navigator.clipboard.writeText(item.hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  // Not-found state
  if (!item) {
    return (
      <div className="ext-popup" data-screen-label="Transaction Details">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={onBack}
            aria-label="Back"
          >
            <BackIcon />
          </button>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            Transaction
          </div>
          <span style={{ flex: 1 }} />
        </div>

        <div className="screen-body">
          <div className="txd-not-found">
            <div className="txd-not-found-title">Transaction not found</div>
            <div className="txd-not-found-text">
              This transaction is no longer available in local history.
            </div>
            <button
              type="button"
              className="btn secondary lg"
              onClick={onBack}
            >
              Back to activity
            </button>
          </div>
        </div>
      </div>
    );
  }

  const variant = getIconVariant(item);
  const isSwap = item.direction === "swap";
  const isBridge = item.direction === "bridge";

  return (
    <div className="ext-popup" data-screen-label="Transaction Details">
      {/* Header */}
      <div className="bar-top">
        <button
          className="icbtn"
          type="button"
          onClick={onBack}
          aria-label="Back"
        >
          <BackIcon />
        </button>
        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          Transaction
        </div>
        <span style={{ flex: 1 }} />
        {item.explorerUrl ? (
          <a
            className="icbtn"
            href={item.explorerUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="View on explorer"
          >
            <ExternalLinkIcon />
          </a>
        ) : null}
      </div>

      {/* Body */}
      <div className="screen-body">
        {/* Hero */}
        <div className="txd-hero">
          <TxIconLarge variant={variant} />
          <div className="txd-hero-title">{getPageTitle(item)}</div>
          <StatusBadge status={item.status} />
        </div>

        {/* Details card */}
        <div className="txd-grid">
          <div className="txd-row">
            <span className="txd-key">Network</span>
            <span className="txd-val">{formatDetailValue(item.chainName)}</span>
          </div>

          <div className="txd-row">
            <span className="txd-key">Date</span>
            <span className="txd-val">{formatTimestamp(item.createdAt)}</span>
          </div>

          {isBridge ? (
            <>
              <div className="txd-row">
                <span className="txd-key">From</span>
                <span className="txd-val">
                  {formatAmount(item.bridgeFromAmount ?? item.amount)}{" "}
                  {item.bridgeFromSymbol ?? item.assetSymbol}
                  {item.bridgeFromChainName
                    ? ` · ${item.bridgeFromChainName}`
                    : ""}
                </span>
              </div>

              <div className="txd-row">
                <span className="txd-key">To (est.)</span>
                <span className="txd-val">
                  {item.bridgeToAmount
                    ? `${formatAmount(item.bridgeToAmount)} ${item.bridgeToSymbol ?? ""}`
                    : "—"}
                  {item.bridgeToChainName ? ` · ${item.bridgeToChainName}` : ""}
                </span>
              </div>

              {item.bridgeProvider ? (
                <div className="txd-row">
                  <span className="txd-key">Provider</span>
                  <span className="txd-val">{item.bridgeProvider}</span>
                </div>
              ) : null}

              {item.bridgeFee ? (
                <div className="txd-row">
                  <span className="txd-key">Route fee</span>
                  <span className="txd-val">{item.bridgeFee}</span>
                </div>
              ) : null}
            </>
          ) : isSwap ? (
            <>
              <div className="txd-row">
                <span className="txd-key">Sent</span>
                <span className="txd-val">
                  {formatAmount(item.swapFromAmount ?? item.amount)}{" "}
                  {item.swapFromSymbol ?? item.assetSymbol}
                </span>
              </div>

              <div className="txd-row">
                <span className="txd-key">Received</span>
                <span className="txd-val">
                  {item.swapToAmount
                    ? `${formatAmount(item.swapToAmount)} ${item.swapToSymbol ?? ""}`
                    : "—"}
                </span>
              </div>

              {item.swapRoute ? (
                <div className="txd-row">
                  <span className="txd-key">Route</span>
                  <span className="txd-val">{formatRoute(item.swapRoute)}</span>
                </div>
              ) : null}

              {item.swapSlippage ? (
                <div className="txd-row">
                  <span className="txd-key">Slippage</span>
                  <span className="txd-val">{item.swapSlippage}</span>
                </div>
              ) : null}

              {item.swapMinimumReceived ? (
                <div className="txd-row">
                  <span className="txd-key">Min received</span>
                  <span className="txd-val">{item.swapMinimumReceived}</span>
                </div>
              ) : null}

              {item.swapNetworkFee ? (
                <div className="txd-row">
                  <span className="txd-key">Network fee</span>
                  <span className="txd-val">{item.swapNetworkFee}</span>
                </div>
              ) : null}

              {item.swapSimpleFee ? (
                <div className="txd-row">
                  <span className="txd-key">Integrator fee</span>
                  <span className="txd-val">{item.swapSimpleFee}</span>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="txd-row">
                <span className="txd-key">From</span>
                <span className="txd-val txd-val--mono">
                  {shortAddress(item.fromAddress)}
                </span>
              </div>

              <div className="txd-row">
                <span className="txd-key">To</span>
                <span className="txd-val txd-val--mono">
                  {shortAddress(item.toAddress)}
                </span>
              </div>

              <div className="txd-row">
                <span className="txd-key">Amount</span>
                <span className="txd-val">
                  {formatAmount(item.amount)} {item.assetSymbol}
                </span>
              </div>
            </>
          )}

          {/* Tx hash row with copy */}
          <div className="txd-row txd-row--hash">
            <span className="txd-key">Tx hash</span>
            <div className="txd-hash-group">
              <span className="txd-val txd-val--mono">{shortHash(item.hash)}</span>
              {item.hash ? (
                <button
                  type="button"
                  className="txd-copy-btn"
                  onClick={() => void copyHash()}
                  aria-label="Copy transaction hash"
                >
                  {copiedHash ? (
                    "Copied"
                  ) : (
                    <>
                      <CopyIcon />
                      Copy
                    </>
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="txd-actions">
          {item.explorerUrl ? (
            <a
              className="btn secondary lg full"
              href={item.explorerUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "none" }}
            >
              View on explorer ↗
            </a>
          ) : null}

          <button
            type="button"
            className="btn secondary lg full"
            onClick={onBack}
          >
            Back to activity
          </button>
        </div>
      </div>
    </div>
  );
}

export default TransactionDetailsPage;
