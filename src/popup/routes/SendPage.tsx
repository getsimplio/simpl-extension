// src/popup/routes/SendPage.tsx

import { useEffect, useState } from "react";
import { isAddress, keccak256 } from "ethers";
import { useTranslation } from "../../i18n";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import { walletService } from "../../core/wallet/wallet.service";
import {
  nativePriceService,
  type NativeAssetQuote,
} from "../../core/prices/native-price.service";
import { transactionHistoryService } from "../../core/transactions/transaction-history.service";
import {
  getNetworkDisplayName,
  isTronChainId,
  isBitcoinChainId,
  isSolanaChainId,
  isTonChainId,
  TRON_MAINNET_CHAIN_ID,
  BITCOIN_MAINNET_CHAIN_ID,
  BITCOIN_TESTNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  TON_MAINNET_CHAIN_ID,
} from "../../core/networks/chain-registry";
import { isValidTronAddress } from "../../chains/tron/tron.address";
import { isValidBitcoinAddress } from "../../chains/bitcoin/bitcoin.address";
import { isValidSolanaAddress } from "../../chains/solana/solana.address";
import { isValidTonAddress } from "../../chains/ton/ton.address";
import {
  getTonTransactionExplorerUrl,
  getTonConfigByChainId,
} from "../../chains/ton/ton.config";
import {
  getBitcoinConfigByChainId,
  getBitcoinTransactionExplorerUrl,
} from "../../chains/bitcoin/bitcoin.config";
import { getBitcoinFeeQuotes } from "../../chains/bitcoin/bitcoin.fees";
import { estimateFeeSats } from "../../chains/bitcoin/bitcoin.transactions";
import { satsToBtc, btcToSats } from "../../chains/bitcoin/bitcoin.format";
import type {
  BitcoinFeePreset,
  BitcoinFeeQuotes,
} from "../../chains/bitcoin/bitcoin.types";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkIcon } from "../components/NetworkIcon";
import { SelectNetworkPage } from "../components/SelectNetworkPage";
import { SelectSendAssetPage } from "./SelectSendAssetPage";

type SendPageProps = {
  asset: WalletAssetBalance;
  selectedAccount: WalletAccount;
  walletState: WalletState;
  onBack: () => void;
  onSent: () => void | Promise<void>;
  // Re-sync global view state after switching network so the rest of the app
  // (e.g. the Home network pill) stays consistent. Does not navigate away.
  onChanged?: () => void | Promise<void>;
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
  // TRX kept back for bandwidth/energy on a native TRX max-send.
  [TRON_MAINNET_CHAIN_ID]: 1,
  // ~0.0002 BTC kept back to cover the network fee on a native BTC max-send.
  [BITCOIN_MAINNET_CHAIN_ID]: 0.0002,
  [BITCOIN_TESTNET_CHAIN_ID]: 0.0002,
  // ~0.001 SOL kept back for the network fee on a native SOL max-send.
  [SOLANA_MAINNET_CHAIN_ID]: 0.001,
  [SOLANA_DEVNET_CHAIN_ID]: 0.001,
  // ~0.05 TON conservative reserve for the network fee (+ first-deploy cost) on
  // a native TON max-send. Matches TON_FEE_RESERVE_NANO in ton.transactions.ts.
  [TON_MAINNET_CHAIN_ID]: 0.05,
};

// Validate a recipient for the active chain's address family.
function isValidRecipientForChain(chainId: number, address: string): boolean {
  const trimmed = address.trim();

  if (isTronChainId(chainId)) {
    return isValidTronAddress(trimmed);
  }

  if (isBitcoinChainId(chainId)) {
    const config = getBitcoinConfigByChainId(chainId);
    return config ? isValidBitcoinAddress(trimmed, config) : false;
  }

  if (isSolanaChainId(chainId)) {
    return isValidSolanaAddress(trimmed);
  }

  if (isTonChainId(chainId)) {
    return isValidTonAddress(trimmed);
  }

  return isAddress(trimmed);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Canonical network name from the chain registry (single source of truth).
const getNetworkLabel = getNetworkDisplayName;

function getExplorerTransactionUrl(chainId: number, hash: string): string | null {
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  if (chainId === 56) return `https://bscscan.com/tx/${hash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${hash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
  if (chainId === TRON_MAINNET_CHAIN_ID)
    return `https://tronscan.org/#/transaction/${hash}`;

  const bitcoinConfig = getBitcoinConfigByChainId(chainId);
  if (bitcoinConfig) {
    return getBitcoinTransactionExplorerUrl(bitcoinConfig, hash);
  }

  const tonConfig = getTonConfigByChainId(chainId);
  if (tonConfig) {
    return getTonTransactionExplorerUrl(tonConfig, hash);
  }

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
  onChanged,
}: SendPageProps) {
  const { t } = useTranslation();
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
  // The account's TRON address, resolved lazily so it can be recorded as the
  // `from` address in local history for TRON sends.
  const [tronFromAddress, setTronFromAddress] = useState<string | null>(null);
  // The account's BTC receive address (the `from` shown in the UI / history).
  const [bitcoinFromAddress, setBitcoinFromAddress] = useState<string | null>(
    null,
  );
  // The account's Solana base58 address (the `from` shown in the UI / history).
  const [solanaFromAddress, setSolanaFromAddress] = useState<string | null>(
    null,
  );
  // The account's TON address (UQ…) (the `from` shown in the UI / history).
  const [tonFromAddress, setTonFromAddress] = useState<string | null>(null);
  // Bitcoin fee presets (sat/vB) + the user's chosen preset.
  const [bitcoinFeeQuotes, setBitcoinFeeQuotes] =
    useState<BitcoinFeeQuotes | null>(null);
  const [bitcoinFeePreset, setBitcoinFeePreset] =
    useState<BitcoinFeePreset>("normal");
  const [error, setError] = useState<string | null>(null);
  const [sentTransaction, setSentTransaction] =
    useState<SentTransaction | null>(null);

  // Validation touch state
  const [toAddressTouched, setToAddressTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);

  const assetUsdPrice = getAssetUsdPrice(selectedAsset, nativeQuote);
  const transferAmount = convertAmountToAsset({
    amount,
    amountMode,
    usdPrice: assetUsdPrice,
  });
  const normalizedAmount = normalizeAmount(transferAmount);
  const isTron = isTronChainId(currentChainId);
  const isBitcoin = isBitcoinChainId(currentChainId);
  const isSolana = isSolanaChainId(currentChainId);
  const isTon = isTonChainId(currentChainId);
  const recipientIsValid = isValidRecipientForChain(currentChainId, toAddress);
  const amountIsValid = isPositiveAmount(normalizedAmount);
  const amountCanBeConverted = amountMode === "asset" || assetUsdPrice !== null;
  const isWatchOnly = selectedAccount.type === "watch";

  // The display/history "from" address for the active chain. Non-EVM families
  // resolve a derived address through the service; EVM uses the stored address.
  const fromAddress = isTron
    ? tronFromAddress ?? selectedAccount.address
    : isBitcoin
      ? bitcoinFromAddress ?? selectedAccount.address
      : isSolana
        ? solanaFromAddress ?? selectedAccount.address
        : isTon
          ? tonFromAddress ?? selectedAccount.address
          : selectedAccount.address;

  const assetBalance = Number(selectedAsset.formatted);
  const toAddressError =
    toAddressTouched && toAddress.length > 0 && !recipientIsValid
      ? isTron
        ? t("send.invalidTronAddress")
        : isBitcoin
          ? t("send.invalidBitcoinAddress")
          : isSolana
            ? t("send.invalidSolanaAddress")
            : isTon
              ? t("send.invalidRecipient")
              : t("send.invalidEvmAddress")
      : null;

  // The chosen Bitcoin fee rate (sat/vB) and a representative network-fee
  // estimate (1 input + 2 outputs). The exact fee is recomputed from real UTXOs
  // at broadcast time; this is the pre-flight estimate the user reviews.
  const bitcoinFeeRate = isBitcoin
    ? bitcoinFeeQuotes?.[bitcoinFeePreset].satPerVb ?? null
    : null;
  const bitcoinEstimatedFeeSats =
    isBitcoin && bitcoinFeeRate != null
      ? estimateFeeSats(1, 2, bitcoinFeeRate)
      : null;
  const bitcoinEstimatedFeeBtc =
    bitcoinEstimatedFeeSats != null ? satsToBtc(bitcoinEstimatedFeeSats) : null;
  // amount + estimated fee, in BTC, for the review screen. Guarded so a bad
  // amount never throws during render.
  const bitcoinTotalBtc = (() => {
    if (!isBitcoin || bitcoinEstimatedFeeSats == null || !amountIsValid) {
      return null;
    }
    try {
      return satsToBtc(btcToSats(normalizedAmount) + bitcoinEstimatedFeeSats);
    } catch {
      return null;
    }
  })();
  // TON has no cheap exact pre-flight fee; we surface the conservative reserve as
  // an upper-bound ("≤") estimate. Native TON only (Jetton send is out of scope).
  const tonIsNativeSend = isTon && selectedAsset.type === "native";
  const tonFeeReserve = GAS_RESERVES[TON_MAINNET_CHAIN_ID] ?? 0.05;
  const tonEstimatedFeeText = tonIsNativeSend
    ? `≤ ${trimDecimal(tonFeeReserve.toFixed(9))} TON`
    : null;
  const tonTotalText =
    tonIsNativeSend && amountIsValid
      ? `≤ ${trimDecimal((Number(normalizedAmount) + tonFeeReserve).toFixed(9))} TON`
      : null;

  const hasInsufficientBalance =
    amountIsValid && Number(normalizedAmount) > assetBalance;
  const amountError =
    amountTouched && hasInsufficientBalance
      ? t("send.insufficientSymbolBalance", { symbol: selectedAsset.symbol })
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

  const canContinue =
    recipientIsValid &&
    amountIsValid &&
    amountCanBeConverted &&
    !sending &&
    !hasInsufficientBalance;

  const networkLabel = getNetworkLabel(currentChainId);
  const assetStandardLabel =
    selectedAsset.type === "native"
      ? "Native"
      : selectedAsset.type === "trc20"
        ? "TRC-20"
        : selectedAsset.type === "spl"
          ? "SPL"
          : "ERC-20";

  useEffect(() => {
    let active = true;

    if (!isTron && !isBitcoin && !isSolana && !isTon) {
      setTronFromAddress(null);
      setBitcoinFromAddress(null);
      setSolanaFromAddress(null);
      setTonFromAddress(null);
      return () => {
        active = false;
      };
    }

    // TRON, Bitcoin, Solana and TON resolve their display "from" address through
    // the wallet service (TRON base58 / BTC receive / Solana base58 / TON UQ…).
    void walletService
      .getSelectedReceiveAddress()
      .then((address) => {
        if (!active) return;
        setBitcoinFromAddress(isBitcoin ? address : null);
        setSolanaFromAddress(isSolana ? address : null);
        setTronFromAddress(isTron ? address : null);
        setTonFromAddress(isTon ? address : null);
      })
      .catch(() => {
        if (!active) return;
        setTronFromAddress(null);
        setBitcoinFromAddress(null);
        setSolanaFromAddress(null);
        setTonFromAddress(null);
      });

    return () => {
      active = false;
    };
  }, [isTron, isBitcoin, isSolana, isTon, currentChainId, selectedAccount.address]);

  // Load Bitcoin fee presets (sat/vB) when on a BTC network. getBitcoinFeeQuotes
  // never throws — it falls back to fixed rates if the provider is down.
  useEffect(() => {
    let active = true;

    if (!isBitcoin) {
      setBitcoinFeeQuotes(null);
      return () => {
        active = false;
      };
    }

    const config = getBitcoinConfigByChainId(currentChainId);
    if (!config) {
      return () => {
        active = false;
      };
    }

    void getBitcoinFeeQuotes(config).then((quotes) => {
      if (active) setBitcoinFeeQuotes(quotes);
    });

    return () => {
      active = false;
    };
  }, [isBitcoin, currentChainId]);

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
        throw new Error(t("send.noAssetsAvailable"));
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

      // Keep the rest of the app (e.g. Home network pill) in sync.
      await onChanged?.();
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
        setError(t("send.balanceTooLowForGas"));
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
      setError(t("send.watchOnlyCannotSend"));
      return;
    }

    if (!recipientIsValid) {
      setError(t("send.invalidRecipient"));
      return;
    }

    if (!amountIsValid) {
      setError(t("errors.invalidAmount"));
      return;
    }

    if (hasInsufficientBalance) {
      setError(t("send.insufficientSymbolBalance", { symbol: selectedAsset.symbol }));
      return;
    }

    if (!amountCanBeConverted) {
      setError(t("send.noPriceForAsset"));
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
        // Bitcoin only — ignored by EVM/TRON.
        feeRateSatPerVb: isBitcoin ? bitcoinFeeRate ?? undefined : undefined,
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
        fromAddress,
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

  if (isWatchOnly) {
    return (
      <div className="ext-popup send-page" data-screen-label="09 Send – Watch-only">
        <div className="bar-top">
          <button className="icbtn" type="button" onClick={onBack}>
            <BackIcon />
          </button>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            {t("send.title")}
          </div>
        </div>
        <div className="screen-body watch-only-guard">
          <div className="watch-only-guard__title">{t("send.watchOnlyTitle")}</div>
          <div className="watch-only-guard__text">
            {t("send.watchOnlyDescription")}
          </div>
          <button className="btn secondary lg full" type="button" onClick={onBack}>
            {t("common.backToWallet")}
          </button>
        </div>
      </div>
    );
  }

  // Network selection — the shared full-screen selector (no modal/sheet).
  // Back returns to the Send form unchanged; selecting switches the network.
  if (networkSelectorOpen) {
    return (
      <SelectNetworkPage
        purpose="send"
        selectedChainId={currentChainId}
        onSelect={(chainId) => void selectNetwork(chainId)}
        onBack={() => setNetworkSelectorOpen(false)}
      />
    );
  }

  // Asset selection — full-screen picker (no modal/sheet). Back leaves the
  // selected asset unchanged; selecting updates the Send form (recipient kept,
  // amount cleared by selectAsset).
  if (assetSelectorOpen) {
    return (
      <SelectSendAssetPage
        assets={availableAssets}
        selectedAssetId={selectedAsset.id}
        networkLabel={networkLabel}
        hideBalances={hideBalances}
        onSelect={(nextAsset) => {
          selectAsset(nextAsset);
          setAssetSelectorOpen(false);
        }}
        onBack={() => setAssetSelectorOpen(false)}
      />
    );
  }

  return (
    <div className="ext-popup send-page" data-screen-label="09 Send">
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
          {t("send.title")}
        </div>

        <span style={{ flex: 1 }} />

        <button
          className="net-chip network-pill-button send-network-chip"
          type="button"
          onClick={() => setNetworkSelectorOpen(true)}
          aria-label={t("common.selectNetwork")}
          title={t("common.selectNetwork")}
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
          className="send-hero"
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
              {t("send.sendSymbol", { symbol: selectedAsset.symbol })}
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
              {t("send.balanceLine", {
                amount: hideBalances ? "••••" : formatAssetBalance(selectedAsset),
                symbol: selectedAsset.symbol,
              })}
            </div>
          </div>
        </section>

        {/* Asset selector card */}
        <section className="send-asset-compact">
          <div className="sect-head">
            <div className="lbl">{t("send.assetToSend")}</div>

            <button
              type="button"
              className="link"
              onClick={() => setAssetSelectorOpen(true)}
              disabled={loadingAssets}
            >
              {loadingAssets ? t("common.loading") : t("common.change")}
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
          <Notice title={t("send.watchOnlyTitle")} tone="warning">
            {t("send.watchOnlyNotice")}
          </Notice>
        ) : null}

        {error ? (
          <Notice title={t("send.error")} tone="danger">
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
            <div className="send-field" style={{ display: "grid", gap: 6 }}>
              <SectionLabel left={t("send.recipientAddress")} />

              <div style={{ position: "relative" }}>
                <input
                  className={`input lg${toAddressError ? " input--error" : ""}`}
                  value={toAddress}
                  placeholder={
                    isTron
                      ? "T..."
                      : isBitcoin
                        ? currentChainId === BITCOIN_TESTNET_CHAIN_ID
                          ? "tb1q..."
                          : "bc1q..."
                        : isSolana
                          ? t("send.solanaRecipientPlaceholder")
                          : "0x..."
                  }
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
                  aria-label={t("send.pasteAddress")}
                >
                  {t("common.paste")}
                </button>
              </div>

              {toAddressError ? (
                <div className="send-field-error">{toAddressError}</div>
              ) : null}
            </div>

            {/* Amount */}
            <div className="send-field" style={{ display: "grid", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <SectionLabel left={t("common.amount")} />

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
                  {t("common.max")}
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
                  title={t("send.switchCurrency")}
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

            <section className="row-list send-summary">
              <MetaRow label={t("common.from")} value={shortAddress(fromAddress)} />
              <MetaRow label={t("common.network")} value={networkLabel} />
              {!isBitcoin ? (
                <MetaRow label={t("home.assetHeader")} value={assetStandardLabel} />
              ) : null}
            </section>

            {/* Bitcoin: network-fee preset (sat/vB) instead of gas language. */}
            {isBitcoin ? (
              <section className="send-field" style={{ display: "grid", gap: 8 }}>
                <SectionLabel
                  left={t("send.networkFee")}
                  right={
                    bitcoinFeeQuotes?.isFallback
                      ? t("send.feesEstimatedOffline")
                      : undefined
                  }
                />

                <div
                  role="group"
                  aria-label={t("send.bitcoinFeeSpeed")}
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
                >
                  {(["slow", "normal", "fast"] as BitcoinFeePreset[]).map(
                    (preset) => {
                      const quote = bitcoinFeeQuotes?.[preset];
                      const active = bitcoinFeePreset === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          className={`btn ${active ? "primary" : "secondary"}`}
                          onClick={() => setBitcoinFeePreset(preset)}
                          style={{
                            display: "grid",
                            gap: 2,
                            padding: "8px 6px",
                            textTransform: "capitalize",
                          }}
                        >
                          <strong style={{ fontSize: 13 }}>
                            {t(`send.feePreset.${preset}`)}
                          </strong>
                          <small style={{ fontSize: 11, opacity: 0.8 }}>
                            {quote ? `${quote.satPerVb} sat/vB` : "…"}
                          </small>
                        </button>
                      );
                    },
                  )}
                </div>

                {bitcoinEstimatedFeeBtc ? (
                  <div className="send-meta-row">
                    <span className="send-meta-label">{t("send.estimatedFee")}</span>
                    <strong className="send-meta-value">
                      ≈ {bitcoinEstimatedFeeBtc} BTC
                      {bitcoinFeeRate != null ? ` · ${bitcoinFeeRate} sat/vB` : ""}
                    </strong>
                  </div>
                ) : null}
              </section>
            ) : null}

            {isTron ? (
              <Notice title={t("send.tronResourcesTitle")} tone="warning">
                {t("send.tronResourcesBody")}
              </Notice>
            ) : null}

            {isSolana ? (
              <Notice title={t("send.solanaFeeTitle")} tone="warning">
                {t("send.solanaFeeBody")}
              </Notice>
            ) : null}

            {tonEstimatedFeeText ? (
              <div className="send-meta-row">
                <span className="send-meta-label">{t("send.estimatedFee")}</span>
                <strong className="send-meta-value">{tonEstimatedFeeText}</strong>
              </div>
            ) : null}

            <button
              className="btn primary lg full send-submit"
              type="submit"
              disabled={!canContinue || isWatchOnly}
              style={{ marginTop: 4 }}
            >
              {t("common.continue")}
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
                  {t("activity.toAddress", { address: shortAddress(toAddress.trim()) })}
                </div>
              </div>
            </div>

            <section style={{ display: "grid", gap: 8 }}>
              <SectionLabel left={t("send.reviewTransfer")} />

              <div className="row-list">
                <MetaRow
                  label={t("common.amount")}
                  value={`${normalizedAmount} ${selectedAsset.symbol}`}
                />
                <MetaRow label={t("common.to")} value={shortAddress(toAddress.trim())} />
                <MetaRow label={t("common.from")} value={shortAddress(fromAddress)} />
                {isBitcoin && bitcoinEstimatedFeeBtc ? (
                  <MetaRow
                    label={t("send.networkFee")}
                    value={`≈ ${bitcoinEstimatedFeeBtc} BTC${
                      bitcoinFeeRate != null ? ` (${bitcoinFeeRate} sat/vB)` : ""
                    }`}
                  />
                ) : null}
                {isBitcoin && bitcoinTotalBtc ? (
                  <MetaRow label={t("common.total")} value={`≈ ${bitcoinTotalBtc} BTC`} />
                ) : null}
                {tonEstimatedFeeText ? (
                  <MetaRow label={t("send.networkFee")} value={tonEstimatedFeeText} />
                ) : null}
                {tonTotalText ? (
                  <MetaRow label={t("common.total")} value={tonTotalText} />
                ) : null}
                <MetaRow label={t("common.network")} value={networkLabel} />
                {!isBitcoin ? (
                  <MetaRow label={t("home.assetHeader")} value={selectedAsset.symbol} />
                ) : null}
              </div>

              {/* Change handling hidden under details (BTC). */}
              {isBitcoin ? (
                <details className="send-change-details">
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--ink-3)",
                      padding: "2px 0",
                    }}
                  >
                    {t("send.advancedDetails")}
                  </summary>
                  <div className="row-list" style={{ marginTop: 6 }}>
                    <MetaRow
                      label={t("common.change")}
                      value={t("send.changeReturnsNote")}
                    />
                    <MetaRow label={t("common.fee")} value={t("send.feeRecalcNote")} />
                  </div>
                </details>
              ) : null}
            </section>

            <Notice title={t("send.checkCarefullyTitle")} tone="warning">
              {t("send.checkCarefullyBody")}
            </Notice>

            <button
              className="btn primary lg full"
              type="button"
              onClick={() => void sendTransaction()}
              disabled={sending}
            >
              <SendIcon />
              {sending ? t("send.sending") : t("send.sendTransaction")}
            </button>

            <button
              className="btn secondary lg full"
              type="button"
              onClick={() => setStep("form")}
              disabled={sending}
            >
              {t("send.editDetails")}
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
              <div className="t-h2">{t("send.transactionSent")}</div>

              <div
                style={{
                  marginTop: 8,
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {t("send.transactionSubmitted", { symbol: selectedAsset.symbol })}
              </div>
            </div>

            <div className="row-list">
              <MetaRow label={t("common.hash")} value={shortAddress(sentTransaction.hash)} />
              <MetaRow
                label={t("common.amount")}
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
                {t("common.openInExplorer")}
              </a>
            ) : null}

            <button className="btn primary lg full" type="button" onClick={onSent}>
              {t("common.done")}
            </button>
          </section>
        ) : null}
      </div>

    </div>
  );
}

export default SendPage;
