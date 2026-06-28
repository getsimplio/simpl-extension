// src/popup/routes/AccountPage.tsx

import { useEffect, useState } from "react";
import { t, useTranslation } from "../../i18n";
import { AccountBlockie } from "../components/AccountBlockie";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import type { AccountDisplayAddress } from "../../core/wallet/wallet.types";
import "./AccountPage.css";

// Per-account public addresses keyed by account id (EVM + optional TRON).
type DisplayAddressMap = Record<string, AccountDisplayAddress[]>;

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

type AccountPageProps = {
  walletState: WalletState;
  onBack: () => void;
  // Opens the full-screen Add account page (add / import / watch chooser).
  onAddAccount: () => void;
  onOpenAccountDetails: (account: WalletAccount) => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Small badge shown next to a non-primary account's name. Primary-seed
// accounts have no badge.
function getAccountBadge(
  account: WalletAccount,
): { label: string; kind: "watch" | "imported" } | null {
  if (account.type === "watch") {
    return { label: t("accounts.watchOnly"), kind: "watch" };
  }
  if (account.type === "importedMnemonic" || account.type === "privateKey") {
    return { label: t("accounts.imported"), kind: "imported" };
  }
  return null;
}

// Short source word used in the account-row subtitle (before the address).
function getAccountSourceShort(account: WalletAccount): string {
  switch (account.type) {
    case "mnemonic":
      return t("accounts.primary");
    case "importedMnemonic":
    case "privateKey":
      return t("accounts.imported");
    case "watch":
      return t("accounts.watchOnly");
  }
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

// One compact public-address row inside an account card. Copy/explorer are
// independent buttons (not nested in the card's clickable header), so they
// never trigger account navigation. No private key material is ever passed in.
function AddressRow({
  row,
  copied,
  onCopy,
}: {
  row: AccountDisplayAddress;
  copied: boolean;
  onCopy: (row: AccountDisplayAddress) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="acct-addr-row">
      <span
        className={`acct-addr-badge acct-addr-badge--${row.family}`}
        aria-hidden="true"
      >
        {row.label}
      </span>

      <span className="acct-addr-text" title={row.address}>
        {shortAddress(row.address)}
      </span>

      <span className="acct-addr-actions">
        <button
          type="button"
          className={`acct-addr-btn${copied ? " acct-addr-copied" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onCopy(row);
          }}
          aria-label={t("accounts.copyAddressLabel", { label: row.label })}
          title={copied ? t("common.copied") : t("common.copyAddress")}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>

        {row.explorerUrl ? (
          <a
            className="acct-addr-btn"
            href={row.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            aria-label={t("accounts.openAddressInExplorer", { label: row.label })}
            title={t("common.viewInExplorer")}
          >
            <ExternalIcon />
          </a>
        ) : null}
      </span>
    </div>
  );
}

// The card header (avatar + name + Active + chevron) is the single button that
// opens AccountDetailsPage. Public address rows render as siblings below it, so
// their copy/explorer controls are not nested inside the header button.
// Switching the active account still happens in details (via "Use account").
function AccountRow({
  account,
  selected,
  disabled,
  addresses,
  copiedKey,
  onCopy,
  onOpenDetails,
}: {
  account: WalletAccount;
  selected: boolean;
  disabled: boolean;
  addresses: AccountDisplayAddress[];
  copiedKey: string | null;
  onCopy: (accountId: string, row: AccountDisplayAddress) => void;
  onOpenDetails: () => void;
}) {
  const { t } = useTranslation();
  const badge = getAccountBadge(account);

  return (
    <div
      className={`acct-row-card${selected ? " acct-row-card--active" : ""}`}
    >
      <button
        className="acct-row-main"
        type="button"
        onClick={onOpenDetails}
        disabled={disabled}
        aria-label={t("accounts.openDetails", { label: account.label })}
      >
        <AccountBlockie address={account.address} size={38} />

        <div className="body">
          <div className="nm acct-row-name">
            <span className="acct-row-name-text">{account.label}</span>
            {badge ? (
              <span
                className={
                  badge.kind === "watch"
                    ? "acct-watch-pill"
                    : "acct-imported-pill"
                }
              >
                {badge.label}
              </span>
            ) : null}
          </div>
          <div className="sub acct-row-sub">{getAccountSourceShort(account)}</div>
        </div>

        <div className="acct-row-aside">
          {selected ? <span className="acct-active-badge">{t("accounts.active")}</span> : null}
          <span className="acct-row-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </div>
      </button>

      {addresses.length > 0 ? (
        <div className="acct-addr-list">
          {addresses.map((row) => (
            <AddressRow
              key={row.label}
              row={row}
              copied={copiedKey === `${account.id}:${row.label}`}
              onCopy={(addressRow) => onCopy(account.id, addressRow)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AccountPage({
  walletState,
  onBack,
  onAddAccount,
  onOpenAccountDetails,
}: AccountPageProps) {
  const { t } = useTranslation();
  // Public per-account addresses (EVM + optional TRON), resolved by the wallet
  // service independently of the selected network. Never holds key material.
  const [displayAddresses, setDisplayAddresses] = useState<DisplayAddressMap>(
    {},
  );
  // `${accountId}:${family}` of the row showing transient "Copied" feedback.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Re-resolve when the account set changes or a TRON address gets persisted.
  const accountsKey = walletState.accounts
    .map(
      (account) =>
        `${account.id}:${
          "tronAddress" in account && account.tronAddress ? "1" : "0"
        }`,
    )
    .join("|");

  useEffect(() => {
    let active = true;

    void walletService
      .getAccountsDisplayAddresses()
      .then((map) => {
        if (active) setDisplayAddresses(map);
      })
      .catch(() => {
        // Keep the synchronous EVM fallback below if resolution fails.
      });

    return () => {
      active = false;
    };
  }, [accountsKey]);

  // Address rows for an account: the resolved set, or a synchronous EVM-only
  // fallback so the card never flashes empty before resolution completes.
  function addressesFor(account: WalletAccount): AccountDisplayAddress[] {
    return (
      displayAddresses[account.id] ?? [
        { family: "evm", label: "EVM", address: account.address },
      ]
    );
  }

  async function handleCopyAddress(
    accountId: string,
    row: AccountDisplayAddress,
  ) {
    try {
      await copyToClipboard(row.address);
      const key = `${accountId}:${row.label}`;
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch {
      // Clipboard unavailable in this context.
    }
  }

  // Signer accounts = anything that can sign (primary, imported phrase, or
  // imported private key). Watch-only accounts are grouped separately.
  const signerAccounts = walletState.accounts.filter(
    (account) => account.type !== "watch",
  );

  const watchAccounts = walletState.accounts.filter(
    (account) => account.type === "watch",
  );

  return (
    <div className="ext-popup acct-page" data-screen-label="06 Accounts">
      {/* ── Top bar ── */}
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="acct-title">{t("accounts.title")}</span>

        <button
          className="icbtn"
          type="button"
          onClick={onAddAccount}
          aria-label={t("accounts.addAccount")}
        >
          <PlusIcon />
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="screen-body">
        {/* ── Signer accounts ── */}
        <section className="acct-section">
          <div className="acct-section-label">{t("accounts.signerAccounts")}</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {signerAccounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                selected={account.id === walletState.selectedAccountId}
                disabled={false}
                addresses={addressesFor(account)}
                copiedKey={copiedKey}
                onCopy={handleCopyAddress}
                onOpenDetails={() => onOpenAccountDetails(account)}
              />
            ))}

            {signerAccounts.length === 0 ? (
              <div className="acct-empty">{t("accounts.noSignerAccounts")}</div>
            ) : null}
          </div>
        </section>

        {/* ── Watch-only accounts ── */}
        {watchAccounts.length > 0 ? (
          <section className="acct-section">
            <div className="acct-section-label">{t("accounts.watchOnly")}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {watchAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  selected={account.id === walletState.selectedAccountId}
                  disabled={false}
                  addresses={addressesFor(account)}
                  copiedKey={copiedKey}
                  onCopy={handleCopyAddress}
                  onOpenDetails={() => onOpenAccountDetails(account)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Add accounts — compact discovery card (opens Add account page) ── */}
        <section className="acct-section">
          <button
            type="button"
            className="acct-add-discover"
            onClick={onAddAccount}
          >
            <div className="acct-add-discover__body">
              <div className="acct-add-discover__title">{t("accounts.needAnother")}</div>
              <div className="acct-add-discover__sub">
                {t("accounts.needAnotherSub")}
              </div>
            </div>

            <span className="acct-add-discover__cta">{t("accounts.addAccount")}</span>
          </button>
        </section>
      </div>
    </div>
  );
}

export default AccountPage;
