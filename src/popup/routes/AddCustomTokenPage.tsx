// src/popup/routes/AddCustomTokenPage.tsx

import { useState } from "react";
import type { ReactNode } from "react";
import { isAddress } from "ethers";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import {
  tokenRegistryService,
  type TokenPreview,
} from "../../core/tokens/token-registry";
import {
  getChainById,
  isTronChainId,
  isSolanaChainId,
} from "../../core/networks/chain-registry";
import { isValidTronAddress } from "../../chains/tron/tron.address";
import { isValidSolanaAddress } from "../../chains/solana/solana.address";
import { walletService } from "../../core/wallet/wallet.service";
import { NetworkIcon } from "../components/NetworkIcon";
import { AssetIcon } from "../components/AssetIcon";
import { Notice } from "../components/Notice";
import { SelectNetworkPage } from "../components/SelectNetworkPage";

type AddCustomTokenPageProps = {
  walletState: WalletState;
  selectedAccount: WalletAccount | null;
  onBack: () => void;
  onAdded: () => void | Promise<void>;
  // Re-sync global view state after switching network so walletState (and the
  // rest of the app) reflects the new active chain — same wiring as Send/Swap.
  onChanged?: () => void | Promise<void>;
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

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
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
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function getNetworkName(chainId: number): string {
  return getChainById(chainId)?.name ?? `Chain ${chainId}`;
}

// Explorer URL for a token contract — TronScan uses hash routes, EVM explorers
// use /token. Returns null when the chain has no known explorer.
function getExplorerTokenUrl(
  chainId: number,
  contractAddress: string,
): string | null {
  if (isTronChainId(chainId)) {
    return `https://tronscan.org/#/token20/${contractAddress}`;
  }

  const base = getChainById(chainId)?.blockExplorerUrl ?? null;
  return base ? `${base}/token/${contractAddress}` : null;
}

// Chain family for the Add Token form. Validation, copy and the token-preview
// flow all branch on this so a Solana mint is never validated as an EVM address.
type ChainKind = "evm" | "tron" | "solana";

function getChainKind(chainId: number): ChainKind {
  if (isTronChainId(chainId)) return "tron";
  if (isSolanaChainId(chainId)) return "solana";
  return "evm";
}

// Chain-aware token address validation. NOTE: base58 chains (TRON, Solana) are
// case-sensitive, so the address is only trimmed — never lowercased — before
// validation. EVM uses ethers' isAddress (accepts checksummed / lowercase).
function isValidTokenAddressForChain(chainId: number, address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  switch (getChainKind(chainId)) {
    case "tron":
      return isValidTronAddress(trimmed);
    case "solana":
      return isValidSolanaAddress(trimmed);
    default:
      return isAddress(trimmed);
  }
}

// The "Enter a valid …" inline error, per chain family.
function invalidAddressMessage(kind: ChainKind): string {
  if (kind === "solana") return "Enter a valid Solana token mint address.";
  if (kind === "tron") return "Enter a valid TRON token contract address.";
  return "Enter a valid EVM contract address.";
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="lbl"
      style={{
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="send-meta-row">
      <span className="send-meta-label">{label}</span>
      <strong className="send-meta-value">{value}</strong>
    </div>
  );
}

export function AddCustomTokenPage({
  walletState,
  selectedAccount,
  onBack,
  onAdded,
  onChanged,
}: AddCustomTokenPageProps) {
  const [tokenAddress, setTokenAddress] = useState("");
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [addingToken, setAddingToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [networkSelectorOpen, setNetworkSelectorOpen] = useState(false);

  const chainId = walletState.selectedChainId;
  const cleanTokenAddress = tokenAddress.trim();
  const selectedChainName = getNetworkName(chainId);
  const chainKind = getChainKind(chainId);
  const isTron = chainKind === "tron";
  const isSolana = chainKind === "solana";

  const addressValid = isValidTokenAddressForChain(chainId, cleanTokenAddress);
  const showAddressError = touched && cleanTokenAddress.length > 0 && !addressValid;

  // Per-chain UI copy. Solana calls it a "mint address"; EVM/TRON keep
  // "contract". Placeholders hint the expected address shape.
  const addressInputLabel = isSolana ? "Token mint address" : "Token contract";
  const addressPlaceholder = isSolana ? "Mint address (base58)" : isTron ? "T…" : "0x…";

  async function loadTokenPreview() {
    setError(null);
    setPreview(null);
    setTouched(true);

    if (!selectedAccount) {
      setError("Selected account not found.");
      return;
    }

    if (!addressValid) {
      setError(null);
      return;
    }

    // The on-chain token preview reader is EVM-only (ethers JsonRpcProvider +
    // ERC-20 ABIs). For Solana the mint format is valid, but reading SPL mint
    // metadata isn't wired into this screen yet — surface a clear chain-specific
    // message instead of running EVM logic (which would throw a misleading EVM
    // error). Never silently no-op.
    if (isSolana) {
      setError(
        "This mint address is valid, but importing SPL tokens from this screen isn’t supported yet. Solana token import is coming soon.",
      );
      return;
    }

    setLoadingPreview(true);

    try {
      const nextPreview = await tokenRegistryService.loadTokenPreview({
        chainId,
        tokenAddress: cleanTokenAddress,
        ownerAddress: selectedAccount.address,
      });

      setPreview(nextPreview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function addToken() {
    if (!preview) return;

    setAddingToken(true);
    setError(null);

    try {
      tokenRegistryService.addToken({
        chainId: preview.chainId,
        address: preview.address,
        symbol: preview.symbol,
        name: preview.name,
        decimals: preview.decimals,
        createdAt: new Date().toISOString(),
      });

      await onAdded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAddingToken(false);
    }
  }

  async function copyContract() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in this surface — ignore.
    }
  }

  // Switch the wallet's active network from the shared header chip — same flow
  // Send/Swap use. After the switch, onChanged re-syncs view state so the
  // walletState prop (and the rest of the app) reflects the new chain.
  async function selectNetwork(nextChainId: number) {
    setNetworkSelectorOpen(false);

    if (nextChainId === chainId) {
      return;
    }

    // A loaded token is chain-specific — clear it when the chain changes.
    setPreview(null);
    setError(null);
    setTouched(false);

    await walletService.setSelectedChainId(nextChainId);
    await onChanged?.();
  }

  const explorerUrl = preview
    ? getExplorerTokenUrl(preview.chainId, preview.address)
    : null;

  // Full-screen network selector — the shared component every page uses. Back
  // returns to the Add token form unchanged; selecting switches the network.
  if (networkSelectorOpen) {
    return (
      <SelectNetworkPage
        purpose="active"
        selectedChainId={chainId}
        onSelect={(nextChainId) => void selectNetwork(nextChainId)}
        onBack={() => setNetworkSelectorOpen(false)}
      />
    );
  }

  return (
    <div className="ext-popup" data-screen-label="07 Add Token">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack}>
          <BackIcon />
        </button>

        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          Add token
        </div>

        <span style={{ flex: 1 }} />

        {/* Active network — shared header chip, opens the same selector as Send/Swap. */}
        <button
          className="net-chip network-pill-button"
          type="button"
          onClick={() => setNetworkSelectorOpen(true)}
          aria-label="Select network"
          title={`Network: ${selectedChainName}`}
        >
          <NetworkIcon
            chainId={chainId}
            networkName={selectedChainName}
            size={16}
            showTestnetBadge={false}
          />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedChainName}
          </span>
        </button>
      </div>

      <div className="screen-body" style={{ display: "grid", gap: 16 }}>
        {/* Intro */}
        <section style={{ paddingTop: 6 }}>
          <div className="t-h2" style={{ fontSize: 30 }}>
            Import token
          </div>

          <div
            style={{
              marginTop: 8,
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Paste a token contract address. Simpl will read the token details and
            show your balance.
          </div>
        </section>

        {/* Contract input */}
        <section style={{ display: "grid", gap: 6 }}>
          <SectionLabel>{addressInputLabel}</SectionLabel>

          <input
            className={`input lg${showAddressError ? " input--error" : ""}`}
            value={tokenAddress}
            placeholder={addressPlaceholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setTokenAddress(event.target.value);
              setPreview(null);
              setError(null);
              if (!touched && event.target.value.trim().length >= 4) {
                setTouched(true);
              }
            }}
            onBlur={() => {
              if (cleanTokenAddress.length > 0) setTouched(true);
            }}
          />

          {showAddressError ? (
            <div className="send-field-error">
              {invalidAddressMessage(chainKind)}
            </div>
          ) : null}

          <button
            className="btn secondary lg full"
            type="button"
            onClick={() => void loadTokenPreview()}
            disabled={loadingPreview || !addressValid}
            style={{ marginTop: 2 }}
          >
            <SearchIcon />
            {loadingPreview ? "Loading token…" : "Load token"}
          </button>
        </section>

        {error ? (
          <Notice tone="danger" title="Couldn’t add this token">
            {error}
          </Notice>
        ) : null}

        {/* Loaded token preview */}
        {preview ? (
          <section style={{ display: "grid", gap: 8 }}>
            <SectionLabel>Token</SectionLabel>

            <div className="row-list">
              <div className="row" style={{ cursor: "default" }}>
                <AssetIcon
                  symbol={preview.symbol}
                  address={preview.address}
                  chainId={preview.chainId}
                  size={38}
                />

                <div className="body">
                  <div className="nm">{preview.name}</div>
                  <div className="sub">{preview.symbol}</div>
                </div>

                <div className="num">
                  <div className="v">
                    {formatTokenAmount(preview.balanceFormatted)}
                  </div>
                </div>
              </div>
            </div>

            <div className="row-list send-summary">
              <MetaRow label="Decimals" value={preview.decimals} />
              <MetaRow
                label="Balance"
                value={`${formatTokenAmount(preview.balanceFormatted)} ${
                  preview.symbol
                }`}
              />

              <div className="send-meta-row">
                <span className="send-meta-label">Contract</span>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 750,
                      color: "var(--ink-1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortAddress(preview.address)}
                  </span>

                  <button
                    type="button"
                    className="icbtn"
                    onClick={() => void copyContract()}
                    aria-label="Copy contract address"
                    title={copied ? "Copied" : "Copy"}
                    style={{
                      width: 28,
                      height: 28,
                      minWidth: 28,
                      color: copied ? "var(--secure)" : "var(--ink-3)",
                    }}
                  >
                    {copied ? (
                      <span style={{ fontSize: 11, fontWeight: 800 }}>✓</span>
                    ) : (
                      <CopyIcon />
                    )}
                  </button>

                  {explorerUrl ? (
                    <a
                      className="icbtn"
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View contract on explorer"
                      title="View on explorer"
                      style={{
                        width: 28,
                        height: 28,
                        minWidth: 28,
                        color: "var(--ink-3)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ExternalIcon />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              className="btn primary lg full"
              type="button"
              onClick={() => void addToken()}
              disabled={addingToken}
              style={{ marginTop: 4 }}
            >
              <PlusIcon />
              {addingToken ? "Importing…" : "Import token"}
            </button>
          </section>
        ) : null}

        {/* Safety */}
        <Notice tone="warning" title="Check the contract address">
          Anyone can create fake tokens. Import tokens only from trusted contract
          addresses.
        </Notice>
      </div>
    </div>
  );
}

export default AddCustomTokenPage;
