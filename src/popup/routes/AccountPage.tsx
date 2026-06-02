// src/popup/routes/AccountPage.tsx

import { useEffect, useState } from "react";
import {
  SimpleInstrumentIcon,
  type SimpleInstrument,
} from "../components/SimpleInstrumentIcon";
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
  onChanged: () => void | Promise<void>;
  onAddWatchWallet: () => void;
  onImportWallet: () => void;
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
    return { label: "Watch-only", kind: "watch" };
  }
  if (account.type === "importedMnemonic" || account.type === "privateKey") {
    return { label: "Imported", kind: "imported" };
  }
  return null;
}

// Short source word used in the account-row subtitle (before the address).
function getAccountSourceShort(account: WalletAccount): string {
  switch (account.type) {
    case "mnemonic":
      return "Primary wallet";
    case "importedMnemonic":
    case "privateKey":
      return "Imported";
    case "watch":
      return "Watch-only";
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
          aria-label={`Copy ${row.label} address`}
          title={copied ? "Copied" : "Copy address"}
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
            aria-label={`Open ${row.label} address in explorer`}
            title="View in explorer"
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
        aria-label={`Open account details for ${account.label}`}
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
          {selected ? <span className="acct-active-badge">Active</span> : null}
          <span className="acct-row-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </div>
      </button>

      {addresses.length > 0 ? (
        <div className="acct-addr-list">
          {addresses.map((row) => (
            <AddressRow
              key={row.family}
              row={row}
              copied={copiedKey === `${account.id}:${row.family}`}
              onCopy={(addressRow) => onCopy(account.id, addressRow)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionCard({
  instrument,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  instrument: SimpleInstrument;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="acct-action-card">
      <button
        className="row"
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          width: "100%",
          border: 0,
          textAlign: "left",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <SimpleInstrumentIcon instrument={instrument} />

        <div className="body">
          <div className="nm">{title}</div>
          <div className="sub">{subtitle}</div>
        </div>

        <div className="num">
          <span className="acct-chevron">
            <ChevronIcon />
          </span>
        </div>
      </button>
    </div>
  );
}

// The three add/import actions — shared between the bottom-of-list section and
// the full-screen "+" options view so the wording stays in sync.
function AddActions({
  addingAccount,
  busy,
  onAddAccount,
  onImportWallet,
  onAddWatchWallet,
}: {
  addingAccount: boolean;
  busy: boolean;
  onAddAccount: () => void;
  onImportWallet: () => void;
  onAddWatchWallet: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <ActionCard
        instrument="multiWallet"
        title={addingAccount ? "Adding account…" : "Add account"}
        subtitle="Create the next account from this wallet."
        disabled={busy}
        onClick={onAddAccount}
      />

      <ActionCard
        instrument="security"
        title="Import wallet"
        subtitle="Use a seed phrase or private key."
        disabled={busy}
        onClick={onImportWallet}
      />

      <ActionCard
        instrument="addressBook"
        title="Add watch wallet"
        subtitle="Track any address without private keys."
        disabled={busy}
        onClick={onAddWatchWallet}
      />
    </div>
  );
}

export function AccountPage({
  walletState,
  onBack,
  onChanged,
  onAddWatchWallet,
  onImportWallet,
  onOpenAccountDetails,
}: AccountPageProps) {
  const [addingAccount, setAddingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Full-screen add/import options, opened from the header "+".
  const [showAddOptions, setShowAddOptions] = useState(false);
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
      const key = `${accountId}:${row.family}`;
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

  const busy = addingAccount;

  async function handleChanged() {
    await onChanged();
  }

  async function addAccount() {
    try {
      setError(null);
      setAddingAccount(true);

      await walletService.addAccount();

      await handleChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingAccount(false);
    }
  }

  // ── Add account options (full screen, opened from header "+") ──
  if (showAddOptions) {
    return (
      <div className="ext-popup acct-page" data-screen-label="Add account">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={() => setShowAddOptions(false)}
            aria-label="Back"
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>
          </button>
          <span className="acct-title">Add account</span>
          <span style={{ width: 32, flexShrink: 0 }} />
        </div>

        <div className="screen-body">
          {error ? <div className="acct-error">{error}</div> : null}

          <AddActions
            addingAccount={addingAccount}
            busy={busy}
            onAddAccount={() => {
              void addAccount().then(() => setShowAddOptions(false));
            }}
            onImportWallet={onImportWallet}
            onAddWatchWallet={onAddWatchWallet}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="ext-popup acct-page" data-screen-label="06 Accounts">
      {/* ── Top bar ── */}
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label="Back">
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

        <span className="acct-title">Accounts</span>

        <button
          className="icbtn"
          type="button"
          onClick={() => {
            setError(null);
            setShowAddOptions(true);
          }}
          aria-label="Add account"
        >
          <PlusIcon />
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="screen-body">
        {error ? (
          <div className="acct-error">{error}</div>
        ) : null}

        {/* ── Signer accounts ── */}
        <section className="acct-section">
          <div className="acct-section-label">Signer accounts</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {signerAccounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                selected={account.id === walletState.selectedAccountId}
                disabled={busy}
                addresses={addressesFor(account)}
                copiedKey={copiedKey}
                onCopy={handleCopyAddress}
                onOpenDetails={() => onOpenAccountDetails(account)}
              />
            ))}

            {signerAccounts.length === 0 ? (
              <div className="acct-empty">No signer accounts yet.</div>
            ) : null}
          </div>
        </section>

        {/* ── Watch-only accounts ── */}
        {watchAccounts.length > 0 ? (
          <section className="acct-section">
            <div className="acct-section-label">Watch-only</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {watchAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  selected={account.id === walletState.selectedAccountId}
                  disabled={busy}
                  addresses={addressesFor(account)}
                  copiedKey={copiedKey}
                  onCopy={handleCopyAddress}
                  onOpenDetails={() => onOpenAccountDetails(account)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Add / import ── */}
        <section className="acct-section">
          <div className="acct-section-label">Add accounts</div>

          <AddActions
            addingAccount={addingAccount}
            busy={busy}
            onAddAccount={() => void addAccount()}
            onImportWallet={onImportWallet}
            onAddWatchWallet={onAddWatchWallet}
          />
        </section>
      </div>
    </div>
  );
}

export default AccountPage;
