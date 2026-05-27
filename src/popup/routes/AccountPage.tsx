// src/popup/routes/AccountPage.tsx

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  WalletAccount,
  WalletAccountId,
} from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";

type AccountPageProps = {
  walletState: WalletState;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onAddWatchWallet: () => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function WalletIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="6" width="16" height="12" rx="3" />
      <path d="M15 12h4" />
      <path d="M7 10h5" />
    </svg>
  );
}

function WatchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
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

function getAccountAvatar(account: WalletAccount): string {
  if (account.type === "watch") return "👁";

  const cleanLabel = account.label.trim();

  if (cleanLabel.length > 0) {
    return cleanLabel.slice(0, 1).toUpperCase();
  }

  return "A";
}

function AccountTypePill({ account }: { account: WalletAccount }) {
  if (account.type === "watch") {
    return (
      <span
        className="pill"
        style={{
          background: "var(--warn-soft)",
          color: "var(--warn)",
        }}
      >
        Watch
      </span>
    );
  }

  return (
    <span
      className="pill"
      style={{
        background: "var(--secure-soft)",
        color: "var(--secure)",
      }}
    >
      Signer
    </span>
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
    <button
      className="row"
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        border: 0,
        textAlign: "left",
        background: selected ? "var(--bg-active)" : "transparent",
        opacity: disabled && !pending ? 0.6 : 1,
      }}
    >
      <div
        className="tok"
        style={{
          background:
            account.type === "watch" ? "var(--bg-sunken)" : "var(--secure-soft)",
          color: account.type === "watch" ? "var(--ink-2)" : "var(--secure)",
        }}
      >
        {getAccountAvatar(account)}
      </div>

      <div className="body">
        <div className="nm">{account.label}</div>

        <div className="sub">
          {shortAddress(account.address)}
          {account.type === "watch" ? " · Watch-only" : ""}
        </div>
      </div>

      <div className="num">
        {pending ? (
          <div className="q">...</div>
        ) : selected ? (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--ink-1)",
              color: "var(--ink-on-dark)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CheckIcon />
          </div>
        ) : (
          <div className="q">
            <ChevronIcon />
          </div>
        )}
      </div>
    </button>
  );
}

function ActionCard({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="row"
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        border: 0,
        textAlign: "left",
        background: "transparent",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div className="tok">{icon}</div>

      <div className="body">
        <div className="nm">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>

      <div className="num">
        <div className="q">
          <ChevronIcon />
        </div>
      </div>
    </button>
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

  const selectedAccount = walletState.accounts.find((account) => {
    return account.id === walletState.selectedAccountId;
  });

  const signerAccounts = walletState.accounts.filter((account) => {
    return account.type === "mnemonic";
  });

  const watchAccounts = walletState.accounts.filter((account) => {
    return account.type === "watch";
  });

  const busy = pendingAccountId !== null || addingAccount;

  async function handleChanged() {
    await onChanged();
  }

  async function selectAccount(accountId: WalletAccountId) {
    if (accountId === walletState.selectedAccountId) return;

    try {
      setError(null);
      setPendingAccountId(accountId);

      await walletService.selectAccount({
        accountId,
      });

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
    <div className="ext-popup" data-screen-label="06 Accounts">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack}>
          <BackIcon />
        </button>

        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink-1)",
          }}
        >
          Accounts
        </div>

        <span style={{ flex: 1 }} />

        {selectedAccount ? (
          <span className="addr-mono">{shortAddress(selectedAccount.address)}</span>
        ) : null}
      </div>

      <div
        className="screen-body"
        style={{
          padding: 16,
          display: "grid",
          gap: 18,
        }}
      >
        <section style={{ padding: "10px 4px 0" }}>
          <div className="t-h2">Wallet accounts</div>

          <div
            style={{
              marginTop: 8,
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Choose the active account or add another EVM address.
          </div>
        </section>

        {error ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--danger-soft)",
              color: "var(--danger)",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        ) : null}

        <section style={{ display: "grid", gap: 8 }}>
          <div
            className="lbl"
            style={{
              padding: "0 4px",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Signer accounts
          </div>

          <div className="row-list">
            {signerAccounts.map((account) => {
              const selected = account.id === walletState.selectedAccountId;

              return (
                <AccountRow
                  key={account.id}
                  account={account}
                  selected={selected}
                  pending={pendingAccountId === account.id}
                  disabled={busy}
                  onClick={() => void selectAccount(account.id)}
                />
              );
            })}

            {signerAccounts.length === 0 ? (
              <div
                style={{
                  padding: 12,
                  color: "var(--ink-3)",
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                No signer accounts yet.
              </div>
            ) : null}
          </div>
        </section>

        {watchAccounts.length > 0 ? (
          <section style={{ display: "grid", gap: 8 }}>
            <div
              className="lbl"
              style={{
                padding: "0 4px",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Watch-only
            </div>

            <div className="row-list">
              {watchAccounts.map((account) => {
                const selected = account.id === walletState.selectedAccountId;

                return (
                  <AccountRow
                    key={account.id}
                    account={account}
                    selected={selected}
                    pending={pendingAccountId === account.id}
                    disabled={busy}
                    onClick={() => void selectAccount(account.id)}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        {selectedAccount ? (
          <section style={{ display: "grid", gap: 8 }}>
            <div
              className="lbl"
              style={{
                padding: "0 4px",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Selected
            </div>

            <div className="row-list">
              <div
                className="row"
                style={{
                  cursor: "default",
                }}
              >
                <div className="tok">
                  {selectedAccount.type === "watch" ? <WatchIcon /> : <WalletIcon />}
                </div>

                <div className="body">
                  <div className="nm">{selectedAccount.label}</div>
                  <div className="sub">{selectedAccount.address}</div>
                </div>

                <div className="num">
                  <AccountTypePill account={selectedAccount} />
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section style={{ display: "grid", gap: 8 }}>
          <div
            className="lbl"
            style={{
              padding: "0 4px",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Add
          </div>

          <div className="row-list">
            <ActionCard
              icon={<PlusIcon />}
              title={addingAccount ? "Adding account..." : "Add account"}
              subtitle="Create the next account from your seed phrase."
              disabled={busy}
              onClick={() => void addAccount()}
            />

            <ActionCard
              icon={<WatchIcon />}
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
