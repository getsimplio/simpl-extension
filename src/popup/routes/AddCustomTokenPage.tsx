// src/popup/routes/AddCustomTokenPage.tsx

import { useState } from "react";
import type { ReactNode } from "react";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import {
  tokenRegistryService,
  type TokenPreview,
} from "../../core/tokens/token-registry";
import { DEFAULT_CHAINS } from "../../core/networks/chain-registry";

type AddCustomTokenPageProps = {
  walletState: WalletState;
  selectedAccount: WalletAccount | null;
  onBack: () => void;
  onAdded: () => void | Promise<void>;
};

type StatusKind = "info" | "success" | "error";

type StatusMessage = {
  kind: StatusKind;
  text: string;
};

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
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

function TokenIcon() {
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
      <circle cx="12" cy="12" r="8" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </svg>
  );
}

function ShieldIcon() {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
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

function getStatusStyle(kind: StatusKind) {
  if (kind === "success") {
    return {
      background: "var(--secure-soft)",
      color: "var(--secure)",
    };
  }

  if (kind === "error") {
    return {
      background: "var(--danger-soft)",
      color: "var(--danger)",
    };
  }

  return {
    background: "var(--warn-soft)",
    color: "var(--warn)",
  };
}

function getNetworkName(chainId: number): string {
  const chain = DEFAULT_CHAINS.find((item) => item.chainId === chainId);

  return chain?.name ?? `Chain ${chainId}`;
}

function getNativeSymbol(chainId: number): string {
  const chain = DEFAULT_CHAINS.find((item) => item.chainId === chainId);

  return chain?.nativeCurrency.symbol ?? "Native";
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTokenAmount(value: string): string {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  if (numericValue === 0) return "0";
  if (numericValue < 0.000001) return "<0.000001";

  if (numericValue < 1) {
    return numericValue.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  return numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div
      className="lbl"
      style={{
        padding: "0 4px",
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div
      className="row"
      style={{
        cursor: "default",
      }}
    >
      <div className="body">
        <div className="sub">{label}</div>
      </div>

      <div className="num">
        <div className="v">{value}</div>
      </div>
    </div>
  );
}

export function AddCustomTokenPage({
  walletState,
  selectedAccount,
  onBack,
  onAdded,
}: AddCustomTokenPageProps) {
  const [tokenAddress, setTokenAddress] = useState("");
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [addingToken, setAddingToken] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const cleanTokenAddress = tokenAddress.trim();
  const selectedChainName = getNetworkName(walletState.selectedChainId);
  const nativeSymbol = getNativeSymbol(walletState.selectedChainId);

  async function loadTokenPreview() {
    setStatus(null);
    setPreview(null);

    if (!selectedAccount) {
      setStatus({
        kind: "error",
        text: "Selected account not found.",
      });
      return;
    }

    if (!cleanTokenAddress) {
      setStatus({
        kind: "info",
        text: "Paste token contract address first.",
      });
      return;
    }

    setLoadingPreview(true);

    try {
      const nextPreview = await tokenRegistryService.loadTokenPreview({
        chainId: walletState.selectedChainId,
        tokenAddress: cleanTokenAddress,
        ownerAddress: selectedAccount.address,
      });

      setPreview(nextPreview);

      setStatus({
        kind: "success",
        text: `${nextPreview.symbol} loaded on ${selectedChainName}. Check the details before adding.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function addToken() {
    if (!preview) return;

    setAddingToken(true);
    setStatus(null);

    try {
      tokenRegistryService.addToken({
        chainId: preview.chainId,
        address: preview.address,
        symbol: preview.symbol,
        name: preview.name,
        decimals: preview.decimals,
        createdAt: new Date().toISOString(),
      });

      setStatus({
        kind: "success",
        text: `${preview.symbol} added to your asset list.`,
      });

      await onAdded();
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAddingToken(false);
    }
  }

  return (
    <div className="ext-popup" data-screen-label="07 Add Token">
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
          Add token
        </div>

        <span style={{ flex: 1 }} />

        <span className="addr-mono">{selectedChainName}</span>
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
          <div className="t-h2">
            Add
            <br />
            custom token
          </div>

          <div
            style={{
              marginTop: 8,
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Paste an ERC-20 or BEP-20 contract address. SIMPLE will read token
            metadata and show your balance.
          </div>
        </section>

        {status ? (
          <div
            style={{
              ...getStatusStyle(status.kind),
              padding: "10px 12px",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {status.text}
          </div>
        ) : null}

        <section style={{ display: "grid", gap: 8 }}>
          <SectionTitle>Token contract</SectionTitle>

          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--bg-surface)",
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <input
                className="input lg"
                value={tokenAddress}
                placeholder="0x..."
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setTokenAddress(event.target.value.trim());
                  setPreview(null);
                  setStatus(null);
                }}
              />
            </label>

            <button
              className="btn secondary lg full"
              type="button"
              onClick={() => void loadTokenPreview()}
              disabled={loadingPreview || cleanTokenAddress.length === 0}
            >
              <TokenIcon />
              {loadingPreview ? "Loading token..." : "Load token"}
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <SectionTitle>Network</SectionTitle>

          <div className="row-list">
            <div
              className="row"
              style={{
                cursor: "default",
              }}
            >
              <div className="tok">
                <NetworkIcon />
              </div>

              <div className="body">
                <div className="nm">{selectedChainName}</div>
                <div className="sub">
                  Native gas token: {nativeSymbol}
                </div>
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

        {selectedAccount ? (
          <section style={{ display: "grid", gap: 8 }}>
            <SectionTitle>Owner account</SectionTitle>

            <div className="row-list">
              <div
                className="row"
                style={{
                  cursor: "default",
                }}
              >
                <div className="tok">
                  {selectedAccount.label.slice(0, 1).toUpperCase()}
                </div>

                <div className="body">
                  <div className="nm">{selectedAccount.label}</div>
                  <div className="sub">{shortAddress(selectedAccount.address)}</div>
                </div>

                <div className="num">
                  <div className="q">{shortAddress(selectedAccount.address)}</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {preview ? (
          <section style={{ display: "grid", gap: 8 }}>
            <SectionTitle>Token preview</SectionTitle>

            <div className="row-list">
              <div
                className="row"
                style={{
                  cursor: "default",
                }}
              >
                <div className="tok">
                  {preview.symbol.slice(0, 1).toUpperCase()}
                </div>

                <div className="body">
                  <div className="nm">{preview.name}</div>
                  <div className="sub">{preview.symbol}</div>
                </div>

                <div className="num">
                  <div className="v">
                    {formatTokenAmount(preview.balanceFormatted)}
                  </div>
                  <div className="q">{preview.symbol}</div>
                </div>
              </div>

              <InfoRow label="Name" value={preview.name} />
              <InfoRow label="Symbol" value={preview.symbol} />
              <InfoRow label="Decimals" value={preview.decimals} />
              <InfoRow
                label="Your balance"
                value={`${formatTokenAmount(preview.balanceFormatted)} ${
                  preview.symbol
                }`}
              />
              <InfoRow
                label="Contract"
                value={shortAddress(preview.address)}
              />
            </div>

            <button
              className="btn primary lg full"
              type="button"
              onClick={() => void addToken()}
              disabled={addingToken}
              style={{ marginTop: 4 }}
            >
              <PlusIcon />
              {addingToken ? "Adding..." : "Add token"}
            </button>
          </section>
        ) : null}

        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
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
              background: "var(--warn-soft)",
              color: "var(--warn)",
            }}
          >
            <ShieldIcon />
          </div>

          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink-1)",
              }}
            >
              Check the contract address
            </div>

            <div
              style={{
                marginTop: 4,
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              Anyone can create fake tokens. Add custom tokens only from trusted
              contract addresses.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default AddCustomTokenPage;
