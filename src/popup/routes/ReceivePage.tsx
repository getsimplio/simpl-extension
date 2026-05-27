// src/popup/routes/ReceivePage.tsx

import { useState } from "react";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import { DEFAULT_CHAINS } from "../../core/networks/chain-registry";

type ReceivePageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onBack: () => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getChainName(chainId: number): string {
  const chain = DEFAULT_CHAINS.find((item) => item.chainId === chainId);

  return chain?.name ?? `Chain ${chainId}`;
}

function getNativeSymbol(chainId: number): string {
  const chain = DEFAULT_CHAINS.find((item) => item.chainId === chainId);

  return chain?.nativeCurrency.symbol ?? "Native";
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function CopyIcon() {
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
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
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
      <path d="M8 10h4" />
    </svg>
  );
}

function NetworkIcon() {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </svg>
  );
}

function WarningIcon() {
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

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";

  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function ReceivePage({
  selectedAccount,
  walletState,
  onBack,
}: ReceivePageProps) {
  const [copied, setCopied] = useState(false);

  const chainName = getChainName(walletState.selectedChainId);
  const nativeSymbol = getNativeSymbol(walletState.selectedChainId);

  async function copyAddress() {
    if (!selectedAccount) return;

    await copyText(selectedAccount.address);

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 1600);
  }

  if (!selectedAccount) {
    return (
      <div className="ext-popup" data-screen-label="10 Receive Empty">
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
            Receive
          </div>
        </div>

        <div
          className="screen-body"
          style={{
            display: "grid",
            gap: 16,
          }}
        >
          <section style={{ paddingTop: 10 }}>
            <div className="t-h2">No account</div>

            <div
              style={{
                marginTop: 8,
                color: "var(--ink-3)",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              Select an account before receiving assets.
            </div>
          </section>

          <button className="btn secondary lg full" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ext-popup" data-screen-label="10 Receive">
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
          Receive
        </div>

        <span style={{ flex: 1 }} />

        <span className="net-chip">{chainName}</span>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gap: 16,
        }}
      >
        <section style={{ paddingTop: 6 }}>
          <div className="t-h2">
            Receive
            <br />
            assets
          </div>

          <div
            style={{
              marginTop: 8,
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Send funds only on the selected EVM network. Using the wrong network
            may cause loss of funds.
          </div>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <div
            className="lbl"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Network
          </div>

          <div className="row-list">
            <div className="row" style={{ cursor: "default" }}>
              <div className="tok">
                <NetworkIcon />
              </div>

              <div className="body">
                <div className="nm">{chainName}</div>
                <div className="sub">Native gas token: {nativeSymbol}</div>
              </div>

              <div className="num">
                <div
                  className="pill"
                  style={{
                    background: "var(--secure-soft)",
                    color: "var(--secure)",
                  }}
                >
                  Active
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <div
            className="lbl"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Account
          </div>

          <div className="row-list">
            <div className="row" style={{ cursor: "default" }}>
              <div className="tok">
                {selectedAccount.label.slice(0, 1).toUpperCase()}
              </div>

              <div className="body">
                <div className="nm">{selectedAccount.label}</div>
                <div className="sub">{shortAddress(selectedAccount.address)}</div>
              </div>

              <div className="num">
                <div className="q">
                  {selectedAccount.type === "watch" ? "Watch" : "Signer"}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--bg-surface)",
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <div
            className="lbl"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Full address
          </div>

          <div
            style={{
              borderRadius: 12,
              background: "var(--bg-sunken)",
              padding: 12,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--ink-1)",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {selectedAccount.address}
          </div>

          <button
            className={copied ? "btn primary lg full" : "btn secondary lg full"}
            type="button"
            onClick={() => void copyAddress()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy address"}
          </button>
        </section>

        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--bg-surface)",
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
              background: "var(--warn-soft)",
              color: "var(--warn)",
            }}
          >
            <WarningIcon />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 750,
                color: "var(--ink-1)",
              }}
            >
              Check the network
            </div>

            <div
              style={{
                marginTop: 4,
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              Only send assets on {chainName}. Deposits from unsupported
              networks may be lost.
            </div>
          </div>
        </section>

        <button className="btn secondary lg full" type="button" onClick={onBack}>
          <WalletIcon />
          Back to wallet
        </button>
      </div>
    </div>
  );
}

export default ReceivePage;
