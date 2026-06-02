// src/popup/routes/ReceivePage.tsx

import { useEffect, useState } from "react";
import type {
  WalletAccount,
  WalletAccountId,
} from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import {
  DEFAULT_CHAINS,
  getNetworkDisplayName,
  getNetworkStandardLabel,
  isTronChainId,
} from "../../core/networks/chain-registry";
import { walletService } from "../../core/wallet/wallet.service";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkIcon } from "../components/NetworkIcon";
import { AccountSelectSheet } from "../components/AccountSelectSheet";
import {
  SelectNetworkPage,
  type NetworkAvailability,
} from "../components/SelectNetworkPage";

type ReceivePageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  // Optional asset to receive (from asset details). When set and on the
  // selected chain, the page shows that asset; otherwise it defaults to the
  // native asset of the selected network.
  receiveAsset?: WalletAssetBalance | null;
  onBack: () => void;
  // Re-sync global view state after switching account, WITHOUT navigating
  // away from the Receive page.
  onChanged?: () => void | Promise<void>;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Canonical network name from the chain registry (single source of truth).
const getNetworkLabel = getNetworkDisplayName;

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

function ChevronRightIcon() {
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
      <path d="M9 6l6 6-6 6" />
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

// Subtle, compact network warning — soft warm tint + border, not a heavy fill.
function Notice({
  title,
  children,
  note,
}: {
  title: string;
  children: string;
  note?: string;
}) {
  return (
    <section className="receive-notice">
      <span className="receive-notice__icon">
        <AlertIcon />
      </span>

      <div className="receive-notice__body">
        <div className="receive-notice__title">{title}</div>
        <div className="receive-notice__text">
          {children}
          {note ? <span className="receive-notice__note"> {note}</span> : null}
        </div>
      </div>
    </section>
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
  receiveAsset,
  onBack,
  onChanged,
}: ReceivePageProps) {
  const [copied, setCopied] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<WalletAccountId | null>(null);
  // Full-screen network selector (replaces the old bottom sheet).
  const [networkSelectOpen, setNetworkSelectOpen] = useState(false);
  const [switchingChainId, setSwitchingChainId] = useState<number | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const chainId = walletState.selectedChainId;
  const networkLabel = getNetworkLabel(chainId);
  const nativeSymbol = getNativeSymbol(chainId);
  const isTron = isTronChainId(chainId);

  // The address to display/copy for the selected network. For EVM this is the
  // account's stored address; for TRON it is the (lazily derived) base58 TRON
  // address resolved through the wallet service.
  const [receiveAddress, setReceiveAddress] = useState<string>(
    selectedAccount?.address ?? "",
  );
  const [addressError, setAddressError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!selectedAccount) {
      setReceiveAddress("");
      return;
    }

    if (!isTron) {
      setReceiveAddress(selectedAccount.address);
      setAddressError(null);
      return;
    }

    setAddressError(null);

    void walletService
      .getSelectedReceiveAddress()
      .then((address) => {
        if (active) setReceiveAddress(address);
      })
      .catch((error) => {
        if (!active) return;
        setReceiveAddress("");
        setAddressError(
          error instanceof Error
            ? error.message
            : "TRON address is unavailable for this account.",
        );
      });

    return () => {
      active = false;
    };
  }, [chainId, isTron, selectedAccount?.id, selectedAccount?.address]);

  // Use the passed receive asset only while it belongs to the selected chain;
  // switching the network in-page falls back to that chain's native asset.
  const displayAsset =
    receiveAsset && receiveAsset.chainId === chainId ? receiveAsset : null;
  const receiveSymbol = displayAsset?.symbol ?? nativeSymbol;
  // A token (ERC-20/BEP-20) receive shows the chain's token standard in the
  // warning; native receives don't.
  const isTokenReceive = Boolean(displayAsset?.contractAddress);
  const standardLabel = getNetworkStandardLabel(chainId);

  // Whether the page was opened for a specific token (asset-specific mode) or
  // for the network's native asset (native mode). In asset-specific mode the
  // token only lives on its own chain in the wallet, so other networks are
  // shown disabled rather than letting the user pick an unsupported network.
  const isAssetSpecific = Boolean(receiveAsset?.contractAddress);

  // In asset-specific mode the token only lives on its own chain in the wallet,
  // so other networks are shown disabled rather than letting the user pick an
  // unsupported network. Native mode: every network is available.
  const networkAvailability: NetworkAvailability | undefined =
    isAssetSpecific && receiveAsset
      ? (candidateChainId) =>
          candidateChainId === receiveAsset.chainId
            ? { available: true }
            : {
                available: false,
                reason: `Not available for ${receiveAsset.symbol}`,
              }
      : undefined;

  const accounts = walletState.accounts;
  const canSwitchAccounts = accounts.length > 1;
  const canSwitchNetworks = DEFAULT_CHAINS.length > 1;

  async function copyAddress() {
    if (!receiveAddress) return;

    await copyText(receiveAddress);

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 1600);
  }

  async function handleSelectAccount(accountId: WalletAccountId) {
    if (accountId === walletState.selectedAccountId) {
      setAccountSheetOpen(false);
      return;
    }

    try {
      setSwitchingId(accountId);
      await walletService.selectAccount({ accountId });
      // Re-sync global state in place; the new selectedAccount flows back in
      // as a prop and the address card / hero / copy target update.
      await onChanged?.();
    } finally {
      setSwitchingId(null);
      setAccountSheetOpen(false);
    }
  }

  function openNetworkSelect() {
    setNetworkError(null);
    setNetworkSelectOpen(true);
  }

  function closeNetworkSelect() {
    setNetworkError(null);
    setNetworkSelectOpen(false);
  }

  async function handleSelectNetwork(nextChainId: number) {
    if (nextChainId === walletState.selectedChainId) {
      setNetworkSelectOpen(false);
      return;
    }

    try {
      setNetworkError(null);
      setSwitchingChainId(nextChainId);
      // Update the GLOBAL selected network (same path as Home/Send/Swap).
      await walletService.setSelectedChainId(nextChainId);
      // Re-sync in place: chainId flows back as a prop, so the pill, hero,
      // warning, native asset and summary all update.
      await onChanged?.();
      // Success → return to the Receive screen.
      setNetworkSelectOpen(false);
    } catch (error) {
      // Stay on the selector and surface the error inline.
      setNetworkError(
        error instanceof Error ? error.message : "Could not switch network.",
      );
    } finally {
      setSwitchingChainId(null);
    }
  }

  // Full-screen network selector — no modal/backdrop/sheet. Back returns to
  // the Receive page without changing the network.
  if (networkSelectOpen) {
    return (
      <SelectNetworkPage
        purpose="receive"
        selectedChainId={chainId}
        busyChainId={switchingChainId}
        error={networkError}
        availability={networkAvailability}
        onSelect={(nextChainId) => void handleSelectNetwork(nextChainId)}
        onBack={closeNetworkSelect}
      />
    );
  }

  if (!selectedAccount) {
    return (
      <div className="ext-popup receive-page" data-screen-label="10 Receive Empty">
        <div className="bar-top">
          <button className="icbtn" type="button" onClick={onBack}>
            <BackIcon />
          </button>

          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            Receive
          </div>
        </div>

        <div className="screen-body" style={{ display: "grid", gap: 14 }}>
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

  const isWatch = selectedAccount.type === "watch";
  const accountLabel = selectedAccount.label || "Account";

  return (
    <div className="ext-popup receive-page" data-screen-label="10 Receive">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack}>
          <BackIcon />
        </button>

        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          Receive
        </div>

        <span style={{ flex: 1 }} />

        <button
          type="button"
          className="net-chip network-pill-button receive-network-pill"
          onClick={openNetworkSelect}
          title={networkLabel}
          aria-label={`Change receive network. Current: ${networkLabel}`}
        >
          <NetworkIcon chainId={chainId} size={16} showTestnetBadge={false} />
          {networkLabel}
          {canSwitchNetworks ? (
            <span className="receive-network-pill__chevron" aria-hidden="true">▾</span>
          ) : null}
        </button>
      </div>

      <div className="screen-body" style={{ display: "grid", gap: 14 }}>
        {/* Hero: asset icon + receive title + network/account subtitle */}
        <section
          className="receive-hero"
          style={{
            display: "grid",
            gridTemplateColumns: "46px 1fr",
            gap: 12,
            alignItems: "center",
            paddingTop: 2,
          }}
        >
          <AssetIcon
            ticker={receiveSymbol}
            logoURI={displayAsset?.logoUrl}
            address={displayAsset?.contractAddress ?? null}
            chainId={chainId}
            size={46}
          />

          <div style={{ minWidth: 0 }}>
            <div className="receive-hero__title">
              Receive {receiveSymbol}
              {isWatch ? (
                <span className="acct-watch-pill receive-watch-pill">Watch-only</span>
              ) : null}
            </div>
            <div className="receive-hero__sub">
              {networkLabel} ·{" "}
              <button
                type="button"
                className="receive-hero__account"
                onClick={() => setAccountSheetOpen(true)}
                aria-label="Change receive account"
              >
                {accountLabel}
              </button>
            </div>
          </div>
        </section>

        {/* Safety notice — tokens also call out the chain's token standard.
            TRON gets an explicit cross-network loss warning. */}
        {isTron ? (
          <Notice
            title="TRON network only"
            note="Sending assets from another network may result in permanent loss."
          >
            Only send TRX or TRC-20 tokens on TRON to this address.
          </Notice>
        ) : (
          <Notice title="Check network" note="Wrong network may cause loss of funds.">
            {isTokenReceive
              ? `Only send ${receiveSymbol} on ${networkLabel}. Use ${standardLabel}.`
              : `Only send ${receiveSymbol} on ${networkLabel}.`}
          </Notice>
        )}

        {networkError ? (
          <div className="receive-network-error">{networkError}</div>
        ) : null}

        {/* Network + account summary */}
        <section className="row-list receive-summary">
          {/* Network row is interactive — opens the network selector */}
          <button
            type="button"
            className="send-meta-row receive-account-row"
            onClick={openNetworkSelect}
            aria-label={`Change receive network. Current: ${networkLabel}`}
          >
            <span className="send-meta-label">Network</span>

            <span className="receive-account-row__value">
              <strong className="send-meta-value" title={networkLabel}>
                {networkLabel}
              </strong>
              {canSwitchNetworks ? (
                <span className="receive-account-row__chevron">
                  <ChevronRightIcon />
                </span>
              ) : null}
            </span>
          </button>

          {/* Account row is interactive — opens the account selector */}
          <button
            type="button"
            className="send-meta-row receive-account-row"
            onClick={() => setAccountSheetOpen(true)}
            aria-haspopup="dialog"
            aria-label={`Change receive account. Current: ${accountLabel}`}
          >
            <span className="send-meta-label">Account</span>

            <span className="receive-account-row__value">
              <strong
                className="send-meta-value"
                title={`${accountLabel}${
                  receiveAddress ? ` · ${shortAddress(receiveAddress)}` : ""
                }`}
              >
                {accountLabel}
                {receiveAddress ? ` · ${shortAddress(receiveAddress)}` : ""}
              </strong>
              {canSwitchAccounts ? (
                <span className="receive-account-row__chevron">
                  <ChevronRightIcon />
                </span>
              ) : null}
            </span>
          </button>
        </section>

        {/* Address card */}
        <section className="receive-address-card">
          <div
            className="lbl"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Wallet address
          </div>

          {addressError ? (
            <div className="receive-network-error">{addressError}</div>
          ) : (
            <>
              <div className="receive-address-short">
                {receiveAddress ? shortAddress(receiveAddress) : "…"}
              </div>

              <div className="receive-address-full">
                {receiveAddress || "Resolving address…"}
              </div>
            </>
          )}

          <button
            className={`btn primary lg full receive-copy-btn${copied ? " receive-copy-btn--copied" : ""}`}
            type="button"
            disabled={!receiveAddress}
            onClick={() => void copyAddress()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy address"}
          </button>
        </section>
      </div>

      {accountSheetOpen ? (
        <AccountSelectSheet
          accounts={accounts}
          selectedAccountId={walletState.selectedAccountId}
          busyAccountId={switchingId}
          onSelect={(accountId) => void handleSelectAccount(accountId)}
          onClose={() => setAccountSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default ReceivePage;
