// src/popup/routes/AddWatchWalletPage.tsx

import { useState } from "react";
import { getAddress, isAddress } from "ethers";
import { walletService } from "../../core/wallet/wallet.service";

type AddWatchWalletPageProps = {
  onAdded: () => void | Promise<void>;
  onBack: () => void;
};

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function EyeIcon() {
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

function AlertIcon() {
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
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
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

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warning" | "danger" | "success";
  title: string;
  children: string;
}) {
  const styles =
    tone === "success"
      ? {
          background: "var(--secure-soft)",
          color: "var(--secure)",
        }
      : tone === "danger"
        ? {
            background: "var(--danger-soft)",
            color: "var(--danger)",
          }
        : {
            background: "var(--warn-soft)",
            color: "var(--warn)",
          };

  return (
    <section
      style={{
        ...styles,
        borderRadius: 16,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "32px 1fr",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <div
        className="tok"
        style={{
          width: 32,
          height: 32,
          minWidth: 32,
          maxWidth: 32,
          background: "rgba(255,255,255,0.55)",
          color: "currentColor",
        }}
      >
        {tone === "success" ? <CheckIcon /> : <AlertIcon />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 750,
            color: "currentColor",
          }}
        >
          {title}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            lineHeight: 1.45,
            color: "currentColor",
            opacity: 0.82,
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span
      className="lbl"
      style={{
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

export function AddWatchWalletPage({
  onAdded,
  onBack,
}: AddWatchWalletPageProps) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedAddress = address.trim();
  const addressIsValid = isAddress(trimmedAddress);
  const checksumAddress = addressIsValid ? getAddress(trimmedAddress) : null;
  const labelValue = label.trim();

  async function addWatchWallet() {
    setError(null);

    if (!addressIsValid || !checksumAddress) {
      setError("Enter a valid EVM address.");
      return;
    }

    setAdding(true);

    try {
      await walletService.addWatchAccount({
        address: checksumAddress,
        label: labelValue || undefined,
      });

      await onAdded();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="ext-popup" data-screen-label="04 Add Watch Wallet">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack}>
          <BackIcon />
        </button>

        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: "var(--ink-1)",
          }}
        >
          Watch wallet
        </div>

        <span style={{ flex: 1 }} />

        <span className="pill">View-only</span>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gap: 16,
        }}
      >
        <section style={{ paddingTop: 6 }}>
          <div
            className="tok"
            style={{
              width: 46,
              height: 46,
              minWidth: 46,
              maxWidth: 46,
              marginBottom: 14,
              background: "var(--ink-1)",
              color: "var(--ink-on-dark)",
            }}
          >
            <EyeIcon />
          </div>

          <div className="t-h2">
            Add watch
            <br />
            wallet
          </div>

          <p
            style={{
              margin: "10px 0 0",
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Track balances for any EVM address without importing private keys.
            Watch-only wallets cannot sign transactions.
          </p>
        </section>

        {error ? (
          <Notice title="Watch wallet error" tone="danger">
            {error}
          </Notice>
        ) : null}

        <form
          style={{ display: "grid", gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            void addWatchWallet();
          }}
        >
          <label style={{ display: "grid", gap: 8 }}>
            <SectionLabel>Wallet address</SectionLabel>

            <input
              className="input lg"
              value={address}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setAddress(event.target.value);
                setError(null);
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <SectionLabel>Label optional</SectionLabel>

            <input
              className="input lg"
              value={label}
              placeholder="Whale wallet, Treasury, Friend..."
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setLabel(event.target.value);
                setError(null);
              }}
            />
          </label>

          {checksumAddress ? (
            <section style={{ display: "grid", gap: 8 }}>
              <SectionLabel>Preview</SectionLabel>

              <div className="row-list">
                <div className="row" style={{ cursor: "default" }}>
                  <div className="tok">
                    <EyeIcon />
                  </div>

                  <div className="body">
                    <div className="nm">{labelValue || "Watch wallet"}</div>
                    <div className="sub">{shortAddress(checksumAddress)}</div>
                  </div>

                  <div className="num">
                    <div
                      className="pill"
                      style={{
                        background: "var(--secure-soft)",
                        color: "var(--secure)",
                      }}
                    >
                      Ready
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <Notice title="No private key needed" tone="warning">
            This wallet is view-only. You can monitor assets, but you cannot send
            funds from this address.
          </Notice>

          <button
            className="btn primary lg full"
            type="submit"
            disabled={!addressIsValid || adding}
          >
            {adding ? "Adding…" : "Add watch wallet"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AddWatchWalletPage;
