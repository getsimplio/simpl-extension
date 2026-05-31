// src/popup/routes/SendPage.tsx

import { useEffect, useState } from "react";
import { isAddress, keccak256 } from "ethers";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import { walletService } from "../../core/wallet/wallet.service";
import {
  nativePriceService,
  type NativeAssetQuote,
} from "../../core/prices/native-price.service";
import { transactionHistoryService } from "../../core/transactions/transaction-history.service";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkIcon } from "../components/NetworkIcon";

type SendPageProps = {
  asset: WalletAssetBalance;
  selectedAccount: WalletAccount;
  walletState: WalletState;
  onBack: () => void;
  onSent: () => void | Promise<void>;
};

type SendStep = "form" | "review" | "success";

type SentTransaction = {
  hash: string;
  explorerUrl: string | null;
};

// Conservative gas reserves by chainId (in native token units)
const GAS_RESERVES: Record<number, number> = {
  1: 0.001,
  56: 0.001,
  8453: 0.0005,
  11155111: 0.01,
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getNetworkLabel(chainId: number): string {
  if (chainId === 1) return "Ethereum";
  if (chainId === 56) return "BNB Chain";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";

  return `Chain ${chainId}`;
}

type SendChainOption = {
  chainId: number;
  name: string;
  nativeSymbol: string;
  subtitle: string;
};

const SEND_CHAIN_OPTIONS: SendChainOption[] = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 1",
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    nativeSymbol: "BNB",
    subtitle: "BNB · Chain 56",
  },
  {
    chainId: 8453,
    name: "Base",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 8453",
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 11155111",
  },
];

function getActiveSendChain(chainId: number): SendChainOption {
  return (
    SEND_CHAIN_OPTIONS.find((chain) => chain.chainId === chainId) ?? {
      chainId,
      name: `Chain ${chainId}`,
      nativeSymbol: "EVM",
      subtitle: `Chain ${chainId}`,
    }
  );
}


function getExplorerTransactionUrl(chainId: number, hash: string): string | null {
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  if (chainId === 56) return `https://bscscan.com/tx/${hash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${hash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;

  return null;
}

function normalizeAmount(value: string): string {
  return value.trim().replace(",", ".");
}

function isPositiveAmount(value: string): boolean {
  const normalizedValue = normalizeAmount(value);

  if (!/^\d+(\.\d+)?$/.test(normalizedValue)) {
    return false;
  }

  return Number(normalizedValue) > 0;
}


function readHideBalancesSetting(): boolean {
  try {
    const rawSettings = localStorage.getItem("settings");
    const rawWalletState = localStorage.getItem("walletState");

    const settings = rawSettings ? JSON.parse(rawSettings) : null;
    const walletState = rawWalletState ? JSON.parse(rawWalletState) : null;

    return (
      settings?.hideBalances === true ||
      walletState?.settings?.hideBalances === true
    );
  } catch {
    return false;
  }
}

function formatAssetBalance(asset: WalletAssetBalance): string {
  const value = Number(asset.formatted);

  if (!Number.isFinite(value)) {
    return asset.formatted;
  }

  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";

  if (value < 1) {
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: asset.decimals === 6 ? 2 : 6,
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function findRawTransactionInText(value: string): `0x${string}` | null {
  const match = value.match(/0x[0-9a-fA-F]{200,}/);

  if (!match) return null;

  return match[0] as `0x${string}`;
}

function getAlreadyKnownTransactionHash(error: unknown): string | null {
  const message = getErrorMessage(error);

  if (!message.toLowerCase().includes("already known")) {
    return null;
  }

  const rawTransaction = findRawTransactionInText(message);

  if (!rawTransaction) {
    return null;
  }

  return keccak256(rawTransaction);
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function SendIcon() {
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
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
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

function ExternalIcon() {
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
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </svg>
  );
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
        borderRadius: 12,
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
          background: "rgba(255,255,255,0.48)",
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

function SectionLabel({
  left,
  right,
}: {
  left: string;
  right?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
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
        {left}
      </div>

      {right ? (
        <div
          style={{
            color: "var(--ink-3)",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}

function MetaRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="send-meta-row">
      <span className="send-meta-label">{label}</span>

      <strong className="send-meta-value" title={value}>
        {value}
      </strong>
    </div>
  );
}


type AmountInputMode = "asset" | "valuation";

type SendValuationCurrency = "USD" | "EUR" | "USDT" | "USDC" | "DAI";

const SEND_VALUATION_STORAGE_KEY = "simple:nativeValuationCurrency";

function isSendValuationCurrency(
  value: string | null,
): value is SendValuationCurrency {
  return (
    value === "USD" ||
    value === "EUR" ||
    value === "USDT" ||
    value === "USDC" ||
    value === "DAI"
  );
}

function getInitialSendValuationCurrency(): SendValuationCurrency {
  try {
    const saved = window.localStorage.getItem(SEND_VALUATION_STORAGE_KEY);

    if (isSendValuationCurrency(saved)) {
      return saved;
    }
  } catch {
    // localStorage is optional.
  }

  return "USD";
}

const USD_STABLE_SYMBOLS = new Set(["USDT", "USDC", "DAI"]);

function getAssetUsdPrice(
  asset: WalletAssetBalance,
  nativeQuote: NativeAssetQuote | null,
): number | null {
  const symbol = asset.symbol.toUpperCase();

  if (USD_STABLE_SYMBOLS.has(symbol)) {
    return 1;
  }

  if (asset.type === "native" && nativeQuote) {
    return nativeQuote.priceUsd;
  }

  return null;
}

function trimDecimal(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function formatUsdInput(value: number): string {
  if (!Number.isFinite(value)) return "";

  if (value === 0) return "0";

  if (value < 0.01) {
    return trimDecimal(value.toFixed(6));
  }

  return trimDecimal(value.toFixed(2));
}

function formatAssetInput(value: number): string {
  if (!Number.isFinite(value)) return "";

  if (value === 0) return "0";

  return trimDecimal(value.toFixed(18));
}

function convertAmountToAsset(input: {
  amount: string;
  amountMode: AmountInputMode;
  usdPrice: number | null;
}): string {
  const value = Number(input.amount);

  if (!Number.isFinite(value) || value <= 0) {
    return input.amount;
  }

  if (input.amountMode === "asset") {
    return input.amount;
  }

  if (!input.usdPrice || input.usdPrice <= 0) {
    return "";
  }

  return formatAssetInput(value / input.usdPrice);
}

function convertAssetAmountToUsd(input: {
  amount: string;
  usdPrice: number | null;
}): string {
  const value = Number(input.amount);

  if (!Number.isFinite(value) || value <= 0 || !input.usdPrice) {
    return "";
  }

  return formatUsdInput(value * input.usdPrice);
}

function convertUsdAmountToAsset(input: {
  amount: string;
  usdPrice: number | null;
}): string {
  const value = Number(input.amount);

  if (!Number.isFinite(value) || value <= 0 || !input.usdPrice) {
    return "";
  }

  return formatAssetInput(value / input.usdPrice);
}


export function SendPage({
  asset,
  selectedAccount,
  walletState,
  onBack,
  onSent,
}: SendPageProps) {
  const [selectedAsset, setSelectedAsset] = useState<WalletAssetBalance>(asset);
  const [availableAssets, setAvailableAssets] = useState<WalletAssetBalance[]>([
    asset,
  ]);

  const [step, setStep] = useState<SendStep>("form");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [amountMode, setAmountMode] = useState<AmountInputMode>("asset");
  const [valuationCurrency] = useState<SendValuationCurrency>(
    getInitialSendValuationCurrency,
  );
  const [nativeQuote, setNativeQuote] = useState<NativeAssetQuote | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const hideBalances = readHideBalancesSetting();
  const [assetSelectorOpen, setAssetSelectorOpen] = useState(false);
  const [networkSelectorOpen, setNetworkSelectorOpen] = useState(false);
  const [currentChainId, setCurrentChainId] = useState(walletState.selectedChainId);
  const [error, setError] = useState<string | null>(null);
  const [sentTransaction, setSentTransaction] =
    useState<SentTransaction | null>(null);

  // Search + validation touch state
  const [assetSearch, setAssetSearch] = useState("");
  const [toAddressTouched, setToAddressTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);

  const assetUsdPrice = getAssetUsdPrice(selectedAsset, nativeQuote);
  const transferAmount = convertAmountToAsset({
    amount,
    amountMode,
    usdPrice: assetUsdPrice,
  });
  const normalizedAmount = normalizeAmount(transferAmount);
  const recipientIsValid = isAddress(toAddress.trim());
  const amountIsValid = isPositiveAmount(normalizedAmount);
  const amountCanBeConverted = amountMode === "asset" || assetUsdPrice !== null;
  const isWatchOnly = selectedAccount.type === "watch";

  const assetBalance = Number(selectedAsset.formatted);
  const toAddressError =
    toAddressTouched && toAddress.length > 0 && !recipientIsValid
      ? "Enter a valid EVM address."
      : null;
  const hasInsufficientBalance =
    amountIsValid && Number(normalizedAmount) > assetBalance;
  const amountError =
    amountTouched && hasInsufficientBalance
      ? `Insufficient ${selectedAsset.symbol} balance.`
      : null;

  const fiatEstimate: string | null = (() => {
    if (!assetUsdPrice || !amount) return null;
    const raw = normalizeAmount(amount);
    if (amountMode === "asset") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      const usd = n * assetUsdPrice;
      return `≈ $${usd < 0.01 ? usd.toFixed(6) : usd.toFixed(2)}`;
    }
    const equiv = convertUsdAmountToAsset({ amount: raw, usdPrice: assetUsdPrice });
    const n = Number(equiv);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `≈ ${trimDecimal(n.toFixed(8))} ${selectedAsset.symbol}`;
  })();

  const filteredAssets = availableAssets
    .filter((item) => {
      if (!assetSearch.trim()) return true;
      const q = assetSearch.toLowerCase();
      return (
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.contractAddress?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      const balA = Number(a.formatted);
      const balB = Number(b.formatted);
      if (balA > 0 && balB <= 0) return -1;
      if (balB > 0 && balA <= 0) return 1;
      return balB - balA;
    });

  const canContinue =
    recipientIsValid &&
    amountIsValid &&
    amountCanBeConverted &&
    !sending &&
    !hasInsufficientBalance;

  const networkLabel = getNetworkLabel(currentChainId);

  useEffect(() => {
    setSelectedAsset(asset);
    setAvailableAssets([asset]);
    setAmount("");
    setAmountMode("asset");
    setNativeQuote(null);
    setError(null);
    setStep("form");
    setToAddressTouched(false);
    setAmountTouched(false);
    setAssetSearch("");
  }, [asset.id]);

  useEffect(() => {
    let active = true;

    if (selectedAsset.type !== "native") {
      setNativeQuote(null);
      return () => {
        active = false;
      };
    }

    const cached = nativePriceService.getCachedNativeQuote(currentChainId);

    if (cached) {
      setNativeQuote(cached);
    }

    void nativePriceService
      .getNativeQuote({
        chainId: currentChainId,
        symbol: selectedAsset.symbol,
      })
      .then((quote) => {
        if (active) {
          setNativeQuote(quote);
        }
      });

    return () => {
      active = false;
    };
  }, [currentChainId, selectedAsset.id, selectedAsset.symbol, selectedAsset.type]);

  useEffect(() => {
    let active = true;

    async function loadAssets() {
      setLoadingAssets(true);

      try {
        const portfolio = await walletService.getSelectedPortfolio();

        if (!active) return;

        const visibleAssets = portfolio.assets.filter((item) => item.visible);

        setAvailableAssets(visibleAssets.length > 0 ? visibleAssets : [asset]);

        const freshSelectedAsset = visibleAssets.find((item) => {
          return item.id === asset.id;
        });

        if (freshSelectedAsset) {
          setSelectedAsset(freshSelectedAsset);
        }
      } catch {
        if (!active) return;

        setAvailableAssets([asset]);
      } finally {
        if (active) {
          setLoadingAssets(false);
        }
      }
    }

    void loadAssets();

    return () => {
      active = false;
    };
  }, [asset.id]);

  const activeSendChain = getActiveSendChain(currentChainId);

  function handleBack() {
    if (step === "review") {
      setStep("form");
      setError(null);
      return;
    }

    if (step === "success") {
      void onSent();
      return;
    }

    onBack();
  }

  function toggleAmountMode() {
    if (!assetUsdPrice) return;

    if (amountMode === "asset") {
      setAmount(convertAssetAmountToUsd({ amount, usdPrice: assetUsdPrice }));
      setAmountMode("valuation");
      setError(null);
      return;
    }

    setAmount(convertUsdAmountToAsset({ amount, usdPrice: assetUsdPrice }));
    setAmountMode("asset");
    setError(null);
  }

  async function selectNetwork(chainId: number) {
    setNetworkSelectorOpen(false);

    if (chainId === currentChainId) {
      return;
    }

    setLoadingAssets(true);
    setError(null);

    try {
      await walletService.setSelectedChainId(chainId);

      const portfolio = await walletService.getSelectedPortfolio();
      const nextAssets = portfolio.assets.filter((item) => item.visible);

      if (nextAssets.length === 0) {
        throw new Error("No assets available on selected network.");
      }

      const preferredAsset =
        nextAssets.find((item) => {
          return (
            item.symbol === selectedAsset.symbol &&
            item.type === selectedAsset.type
          );
        }) ??
        nextAssets.find((item) => item.type === "native") ??
        nextAssets[0];

      setCurrentChainId(chainId);
      setAvailableAssets(nextAssets);
      setSelectedAsset(preferredAsset);
      setAmount("");
      setAmountMode("asset");
      setToAddress("");
      setSentTransaction(null);
      setStep("form");
      setToAddressTouched(false);
      setAmountTouched(false);
    } catch (error) {
      const alreadyKnownHash = getAlreadyKnownTransactionHash(error);

      if (alreadyKnownHash) {
        setSentTransaction({
          hash: alreadyKnownHash,
          explorerUrl: getExplorerTransactionUrl(currentChainId, alreadyKnownHash),
        });

        setStep("success");
        return;
      }

      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAssets(false);
    }
  }

  function selectAsset(nextAsset: WalletAssetBalance) {
    setSelectedAsset(nextAsset);
    setAmount("");
    setAmountMode("asset");
    setNativeQuote(null);
    setError(null);
    setStep("form");
    setAmountTouched(false);
  }

  function handleMaxAmount() {
    setAmountTouched(false);
    setError(null);
    setAmountMode("asset");

    if (selectedAsset.type === "native") {
      const balance = Number(selectedAsset.formatted);
      const reserve = GAS_RESERVES[currentChainId] ?? 0.002;
      const maxSend = balance - reserve;
      if (maxSend <= 0) {
        setError("Balance too low to cover gas fees.");
        return;
      }
      setAmount(trimDecimal(maxSend.toFixed(8)));
      return;
    }

    setAmount(selectedAsset.formatted);
  }

  async function handlePasteAddress() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      setToAddress(trimmed);
      setToAddressTouched(true);
      setError(null);
    } catch {
      // Clipboard unavailable in this context
    }
  }

  function submitForm() {
    setError(null);
    setToAddressTouched(true);
    setAmountTouched(true);

    if (isWatchOnly) {
      setError("Watch-only account cannot send transactions.");
      return;
    }

    if (!recipientIsValid) {
      setError("Enter a valid recipient address.");
      return;
    }

    if (!amountIsValid) {
      setError("Enter a valid amount.");
      return;
    }

    if (hasInsufficientBalance) {
      setError(`Insufficient ${selectedAsset.symbol} balance.`);
      return;
    }

    if (!amountCanBeConverted) {
      setError("USD price is unavailable for this asset.");
      return;
    }

    setStep("review");
  }

  async function sendTransaction() {
    if (!canContinue || isWatchOnly) return;

    setSending(true);
    setError(null);

    try {
      const result = await walletService.sendSelectedAsset({
        asset: selectedAsset,
        toAddress: toAddress.trim(),
        amount: normalizedAmount,
      });

      transactionHistoryService.addTransaction({
        hash: result.hash,
        chainId: currentChainId,
        chainName: getNetworkLabel(currentChainId),
        direction: "send",
        status: "submitted",
        assetType: selectedAsset.type,
        assetSymbol: selectedAsset.symbol,
        assetName: selectedAsset.name,
        contractAddress: selectedAsset.contractAddress,
        amount: normalizedAmount,
        fromAddress: selectedAccount.address,
        toAddress: toAddress.trim(),
        explorerUrl: result.explorerUrl,
        createdAt: new Date().toISOString(),
      });

      setSentTransaction({
        hash: result.hash,
        explorerUrl: result.explorerUrl,
      });

      setStep("success");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ext-popup" data-screen-label="09 Send">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={handleBack}>
          <BackIcon />
        </button>

        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: "var(--ink-1)",
          }}
        >
          Send
        </div>

        <span style={{ flex: 1 }} />

        <button
          className="net-chip network-pill-button send-network-chip"
          type="button"
          onClick={() => setNetworkSelectorOpen(true)}
          aria-label="Select network"
          title="Select network"
        >
          <NetworkIcon chainId={currentChainId} size={16} showTestnetBadge={false} />
          {networkLabel}
        </button>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gap: 16,
        }}
      >
        {/* Hero: asset icon + name + balance */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "46px 1fr",
            gap: 12,
            alignItems: "center",
            paddingTop: 6,
          }}
        >
          <AssetIcon
            ticker={selectedAsset.symbol}
            logoURI={selectedAsset.logoUrl}
            address={selectedAsset.contractAddress}
            chainId={selectedAsset.chainId}
            size={46}
          />

          <div style={{ minWidth: 0 }}>
            <div className="t-h2" style={{ fontSize: 30 }}>
              Send {selectedAsset.symbol}
            </div>

            <div
              style={{
                marginTop: 4,
                color: "var(--ink-3)",
                fontSize: 13,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Balance: {hideBalances ? "••••" : formatAssetBalance(selectedAsset)} {selectedAsset.symbol}
            </div>
          </div>
        </section>

        {/* Asset selector card */}
        <section className="send-asset-compact">
          <div className="sect-head">
            <div className="lbl">Asset to send</div>

            <button
              type="button"
              className="link"
              onClick={() => setAssetSelectorOpen(true)}
              disabled={loadingAssets}
            >
              {loadingAssets ? "Loading…" : "Change"}
            </button>
          </div>

          <button
            type="button"
            className="send-asset-card"
            onClick={() => setAssetSelectorOpen(true)}
          >
            <AssetIcon
              ticker={selectedAsset.symbol}
              logoURI={selectedAsset.logoUrl}
              address={selectedAsset.contractAddress}
              chainId={selectedAsset.chainId}
              size={42}
              className="send-asset-card__icon"
            />

            <span className="send-asset-card__body">
              <strong>{selectedAsset.symbol}</strong>
              <small>{selectedAsset.name}</small>
            </span>

            <span className="send-asset-card__balance">
              <strong>{hideBalances ? "••••" : formatAssetBalance(selectedAsset)}</strong>
              <small>{selectedAsset.symbol}</small>
            </span>

            <span className="send-asset-card__chevron">›</span>
          </button>
        </section>

        {isWatchOnly ? (
          <Notice title="Watch-only account" tone="warning">
            This account can receive assets, but cannot sign outgoing transactions.
          </Notice>
        ) : null}

        {error ? (
          <Notice title="Send error" tone="danger">
            {error}
          </Notice>
        ) : null}

        {step === "form" ? (
          <form
            style={{ display: "grid", gap: 12 }}
            onSubmit={(event) => {
              event.preventDefault();
              submitForm();
            }}
          >
            {/* Recipient address */}
            <div style={{ display: "grid", gap: 6 }}>
              <SectionLabel left="Recipient address" />

              <div style={{ position: "relative" }}>
                <input
                  className={`input lg${toAddressError ? " input--error" : ""}`}
                  value={toAddress}
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setToAddress(event.target.value);
                    setError(null);
                    if (!toAddressTouched && event.target.value.length >= 4) {
                      setToAddressTouched(true);
                    }
                  }}
                  onBlur={() => {
                    if (toAddress.length > 0) setToAddressTouched(true);
                  }}
                  style={{ paddingRight: 72, width: "100%" }}
                />
                <button
                  type="button"
                  className="send-paste-btn"
                  onClick={() => void handlePasteAddress()}
                  aria-label="Paste address from clipboard"
                >
                  Paste
                </button>
              </div>

              {toAddressError ? (
                <div className="send-field-error">{toAddressError}</div>
              ) : null}
            </div>

            {/* Amount */}
            <div style={{ display: "grid", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <SectionLabel left="Amount" />

                <button
                  type="button"
                  className="pill"
                  onClick={handleMaxAmount}
                  style={{
                    border: 0,
                    cursor: "pointer",
                    background: "var(--secure-soft)",
                    color: "var(--secure)",
                  }}
                >
                  Max
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <input
                  className={`input lg${amountError ? " input--error" : ""}`}
                  value={amount}
                  placeholder="0.00"
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError(null);
                    if (!amountTouched && event.target.value.length >= 1) {
                      setAmountTouched(true);
                    }
                  }}
                  onBlur={() => {
                    if (amount.length > 0) setAmountTouched(true);
                  }}
                  style={{ paddingRight: 70 }}
                />

                <button
                  type="button"
                  className="amount-unit-toggle"
                  onClick={toggleAmountMode}
                  title="Switch amount currency"
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                >
                  {amountMode === "valuation"
                    ? valuationCurrency
                    : selectedAsset.symbol}
                </button>
              </div>

              {amountError ? (
                <div className="send-field-error">{amountError}</div>
              ) : fiatEstimate ? (
                <div className="send-fiat-estimate">{fiatEstimate}</div>
              ) : null}
            </div>

            <section className="row-list">
              <MetaRow label="From" value={shortAddress(selectedAccount.address)} />
              <MetaRow label="Network" value={networkLabel} />
              <MetaRow
                label="Asset"
                value={selectedAsset.type === "native" ? "Native" : "ERC-20"}
              />
            </section>

            <button
              className="btn primary lg full"
              type="submit"
              disabled={!canContinue || isWatchOnly}
              style={{ marginTop: 4 }}
            >
              Continue
            </button>
          </form>
        ) : null}

        {step === "review" ? (
          <section style={{ display: "grid", gap: 12 }}>
            {/* Review header: asset icon + amount summary */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "4px 0 4px",
              }}
            >
              <AssetIcon
                ticker={selectedAsset.symbol}
                logoURI={selectedAsset.logoUrl}
                address={selectedAsset.contractAddress}
                chainId={selectedAsset.chainId}
                size={44}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {normalizedAmount} {selectedAsset.symbol}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    color: "var(--ink-3)",
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  To {shortAddress(toAddress.trim())}
                </div>
              </div>
            </div>

            <section style={{ display: "grid", gap: 8 }}>
              <SectionLabel left="Review transfer" />

              <div className="row-list">
                <MetaRow
                  label="Amount"
                  value={`${normalizedAmount} ${selectedAsset.symbol}`}
                />
                <MetaRow label="To" value={shortAddress(toAddress.trim())} />
                <MetaRow label="From" value={shortAddress(selectedAccount.address)} />
                <MetaRow label="Network" value={networkLabel} />
                <MetaRow label="Asset" value={selectedAsset.symbol} />
              </div>
            </section>

            <Notice title="Check carefully" tone="warning">
              Transactions cannot be cancelled after they are sent.
            </Notice>

            <button
              className="btn primary lg full"
              type="button"
              onClick={() => void sendTransaction()}
              disabled={sending}
            >
              <SendIcon />
              {sending ? "Sending…" : "Send transaction"}
            </button>

            <button
              className="btn secondary lg full"
              type="button"
              onClick={() => setStep("form")}
              disabled={sending}
            >
              Edit details
            </button>
          </section>
        ) : null}

        {step === "success" && sentTransaction ? (
          <section style={{ display: "grid", gap: 14, paddingTop: 18 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--secure-soft)",
                color: "var(--secure)",
              }}
            >
              <CheckIcon />
            </div>

            <div>
              <div className="t-h2">
                Transaction
                <br />
                sent
              </div>

              <div
                style={{
                  marginTop: 8,
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                Your {selectedAsset.symbol} transfer was submitted to the network.
              </div>
            </div>

            <div className="row-list">
              <MetaRow label="Hash" value={shortAddress(sentTransaction.hash)} />
              <MetaRow
                label="Amount"
                value={`${normalizedAmount} ${selectedAsset.symbol}`}
              />
            </div>

            {sentTransaction.explorerUrl ? (
              <a
                className="btn secondary lg full"
                href={sentTransaction.explorerUrl}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "none" }}
              >
                <ExternalIcon />
                Open in explorer
              </a>
            ) : null}

            <button className="btn primary lg full" type="button" onClick={onSent}>
              Done
            </button>
          </section>
        ) : null}
      </div>

      {/* Network selector sheet */}
      {networkSelectorOpen ? (
        <div className="send-network-sheet-backdrop">
          <button
            type="button"
            className="send-network-sheet-scrim"
            aria-label="Close network selector"
            onClick={() => setNetworkSelectorOpen(false)}
          />

          <section className="send-network-sheet">
            <div className="send-network-sheet-head">
              <div>
                <div className="send-network-sheet-title">Select network</div>
                <div className="send-network-sheet-subtitle">
                  Current: {activeSendChain.name}
                </div>
              </div>

              <button
                type="button"
                className="icbtn"
                aria-label="Close network selector"
                onClick={() => setNetworkSelectorOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="row-list">
              {SEND_CHAIN_OPTIONS.map((chain) => {
                const active = chain.chainId === currentChainId;

                return (
                  <button
                    key={chain.chainId}
                    type="button"
                    className="row send-network-sheet-row"
                    onClick={() => void selectNetwork(chain.chainId)}
                    style={{
                      width: "100%",
                      border: 0,
                      background: active ? "var(--bg-sunken)" : "transparent",
                      textAlign: "left",
                    }}
                  >
                    <NetworkIcon
                      chainId={chain.chainId}
                      networkName={chain.name}
                      size={36}
                      showTestnetBadge={chain.chainId === 11155111}
                    />

                    <div className="body">
                      <div className="nm">{chain.name}</div>
                      <div className="sub">{chain.subtitle}</div>
                    </div>

                    <div className="num">
                      <div
                        className="v"
                        style={active ? { color: "var(--secure)" } : undefined}
                      >
                        {active ? "Active" : "›"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {/* Asset selector sheet */}
      {assetSelectorOpen ? (
        <div className="asset-sheet-backdrop">
          <button
            type="button"
            className="asset-sheet-scrim"
            aria-label="Close asset selector"
            onClick={() => {
              setAssetSelectorOpen(false);
              setAssetSearch("");
            }}
          />

          <section className="asset-sheet">
            {/* Sticky header + search */}
            <div className="asset-sheet-sticky">
              <div className="asset-sheet-head">
                <div>
                  <div className="asset-sheet-title">Select asset</div>
                  <div className="asset-sheet-subtitle">
                    Choose token to send on {networkLabel}.
                  </div>
                </div>

                <button
                  type="button"
                  className="icbtn"
                  aria-label="Close asset selector"
                  onClick={() => {
                    setAssetSelectorOpen(false);
                    setAssetSearch("");
                  }}
                >
                  ×
                </button>
              </div>

              <div className="asset-sheet-search-wrap">
                <input
                  className="input asset-sheet-search"
                  type="text"
                  placeholder="Search symbol or address…"
                  value={assetSearch}
                  autoComplete="off"
                  onChange={(e) => setAssetSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Scrollable asset list */}
            <div className="asset-sheet-scroll-body">
              <div className="row-list">
                {filteredAssets.length === 0 ? (
                  <div className="asset-sheet-empty">No assets found.</div>
                ) : (
                  filteredAssets.map((item) => {
                    const active = item.id === selectedAsset.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="row asset-sheet-row"
                        onClick={() => {
                          selectAsset(item);
                          setAssetSelectorOpen(false);
                          setAssetSearch("");
                        }}
                        style={{
                          width: "100%",
                          border: 0,
                          background: active ? "var(--bg-sunken)" : "transparent",
                          textAlign: "left",
                        }}
                      >
                        <AssetIcon
                          ticker={item.symbol}
                          logoURI={item.logoUrl}
                          address={item.contractAddress}
                          chainId={item.chainId}
                          size={36}
                        />

                        <div className="body">
                          <div className="nm">{item.symbol}</div>
                          <div className="sub">{item.name}</div>
                        </div>

                        <div className="num">
                          <div className="v">
                            {hideBalances ? "••••" : formatAssetBalance(item)}
                          </div>
                          <div
                            className="q"
                            style={active ? { color: "var(--secure)" } : undefined}
                          >
                            {active ? "✓" : item.symbol}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default SendPage;
