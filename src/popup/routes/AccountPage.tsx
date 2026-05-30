// src/popup/routes/AccountPage.tsx

import { useState } from "react";
import {
  SimpleInstrumentIcon,
  type SimpleInstrument,
} from "../components/SimpleInstrumentIcon";
import { PixelAvatar } from "../components/PixelAvatar";
import type {
  WalletAccount,
  WalletAccountId,
} from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import "./AccountPage.css";

type AccountPageProps = {
  walletState: WalletState;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onAddWatchWallet: () => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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

function AccountRow({
  account,
  selected,
  pending,
  disabled,
  onClick,
}: {
  account: WalletAccount;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`acct-row-card${selected ? " acct-row-card--active" : ""}`}>
      <button
        className="row"
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          width: "100%",
          border: 0,
          textAlign: "left",
          opacity: disabled && !pending ? 0.6 : 1,
        }}
      >
        <PixelAvatar
          seed={account.address}
          size={38}
          label={account.label}
          variant={account.type === "watch" ? "watch" : selected ? "selected" : "signer"}
        />

        <div className="body">
          <div className="nm acct-row-name">
            <span className="acct-row-name-text">{account.label}</span>
            {account.type === "watch" ? (
              <span className="acct-watch-pill">Watch</span>
            ) : null}
          </div>
          <div className="sub">{shortAddress(account.address)}</div>
        </div>

        <div className="num">
          {pending ? (
            <span className="acct-pending">···</span>
          ) : selected ? (
            <span className="acct-active-badge">Active</span>
          ) : (
            <span className="acct-chevron">
              <ChevronIcon />
            </span>
          )}
        </div>
      </button>
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

export function AccountPage({
  walletState,
  onBack,
  onChanged,
  onAddWatchWallet,
}: AccountPageProps) {
  const [pendingAccountId, setPendingAccountId] =
    useState<WalletAccountId | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signerAccounts = walletState.accounts.filter(
    (account) => account.type === "mnemonic",
  );

  const watchAccounts = walletState.accounts.filter(
    (account) => account.type === "watch",
  );

  const busy = pendingAccountId !== null || addingAccount;

  async function handleChanged() {
    await onChanged();
  }

  async function selectAccount(accountId: WalletAccountId) {
    if (accountId === walletState.selectedAccountId) return;

    try {
      setError(null);
      setPendingAccountId(accountId);

      await walletService.selectAccount({ accountId });

      await handleChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAccountId(null);
    }
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

        {/* Spacer to balance back button and keep title centered */}
        <span style={{ width: 32, flexShrink: 0 }} />
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
                pending={pendingAccountId === account.id}
                disabled={busy}
                onClick={() => void selectAccount(account.id)}
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
                  pending={pendingAccountId === account.id}
                  disabled={busy}
                  onClick={() => void selectAccount(account.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Add accounts ── */}
        <section className="acct-section">
          <div className="acct-section-label">Add accounts</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <ActionCard
              instrument="multiWallet"
              title={addingAccount ? "Adding account…" : "Add account"}
              subtitle="Create the next account from your seed phrase."
              disabled={busy}
              onClick={() => void addAccount()}
            />

            <ActionCard
              instrument="wallet"
              title="Add watch wallet"
              subtitle="Track any address without importing private keys."
              disabled={busy}
              onClick={onAddWatchWallet}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

export default AccountPage;
