// src/popup/routes/HomePage.tsx

import { useEffect, useRef, useState } from "react";
import { SimpleInstrumentIcon } from "../components/SimpleInstrumentIcon";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkIcon } from "../components/NetworkIcon";
import { AccountBlockie } from "../components/AccountBlockie";
import ManageAssetsPage from "./ManageAssetsPage";
import ValueCurrencyPage from "./ValueCurrencyPage";
import type { WalletAccount } from "../../core/accounts/account.types";
import { isWatchOnly } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import {
  nativePriceService,
  type NativeAssetQuote,
} from "../../core/prices/native-price.service";
import { tokenPriceService } from "../../core/prices/token-price.service";
import {
  priceHistoryService,
  type PriceHistoryRange,
} from "../../core/prices/price-history.service";
import {
  countsTowardTotalBalance,
  isKnownPriceAsset,
  priceDebug,
} from "../../core/prices/price-identity";
import {
  marketDataService,
  type AssetMarketData,
} from "../../core/prices/market-data.service";
import {
  resolveAsset,
  getPriceOhlc,
  toBackendChainId,
} from "../../core/prices/simpl-market-api.service";
import {
  PriceChart,
  type ChartPoint,
  type CandlePoint,
} from "../components/PriceChart";
import { walletService } from "../../core/wallet/wallet.service";
import { customTokenService } from "../../core/tokens/custom-token.service";
import { hiddenAssetService } from "../../core/tokens/hidden-asset.service";
import {
  getChainById,
  getChainFamily,
  getNetworkDisplayName,
  getCompactNetworkName,
  isTronChainId,
  isBitcoinChainId,
  isSolanaChainId,
  isTonChainId,
  SOLANA_DEVNET_CHAIN_ID,
} from "../../core/networks/chain-registry";
import { SelectNetworkPage } from "../components/SelectNetworkPage";
import { getRequiredSolanaConfigByChainId } from "../../chains/solana/solana.config";
import { loadSplTokenMetadata } from "../../chains/solana/solana.tokens";
import { SOL_WSOL_MINT } from "../../core/swaps/solana-swap.service";
import {
  transactionHistoryService,
  type TransactionHistoryItem,
} from "../../core/transactions/transaction-history.service";
import { useTranslation, t } from "../../i18n";

type CachedPortfolio = {
  assets: WalletAssetBalance[];
  updatedAt: number;
};

type PortfolioStatus =
  | "idle"
  | "loading"
  | "fresh"
  | "syncing"
  | "stale"
  | "error";

type ValuationCurrency = "USD" | "USDT" | "EUR";

type HomePageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onAccounts: () => void;
  onReceive: (asset?: WalletAssetBalance) => void;
  onSwap: (asset?: WalletAssetBalance) => void;
  onHistory: () => void;
  onRevealSeed: () => void;
  onRevealPrivateKey: () => void;
  onSettings: () => void;
  onAddCustomToken: () => void;
  onSendAsset: (asset: WalletAssetBalance) => void;
  onRefresh: () => void | Promise<void>;
};

const DEFAULT_BALANCE_REFRESH_SECONDS = 30;
const PORTFOLIO_RETRY_DELAYS_MS = [3000, 5000, 10000, 20000, 30000];

// Toggle structured balance-refresh diagnostics in the popup console. Logs only
// public data (account label, chainId, public address, asset counts, timings,
// error name/message/code/stack) — never seed phrase / private key / password.
const BALANCE_DEBUG = true;

function balanceLog(...args: unknown[]): void {
  if (BALANCE_DEBUG) console.log("[balances]", ...args);
}

// Normalize an unknown thrown value into a safe, structured shape for logging.
// Includes a `code` field because RPC/HTTP errors often carry one.
function describeError(error: unknown): {
  name: string;
  message: string;
  code: unknown;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: (error as { code?: unknown }).code,
      stack: error.stack,
    };
  }
  return { name: "NonError", message: String(error), code: undefined };
}

const VALUATION_STORAGE_KEY = "simple:nativeValuationCurrency";

// Asset Detail chart type preference (Line vs Candles), persisted across views.
type ChartTypePref = "candles" | "line";
const CHART_MODE_STORAGE_KEY = "simpl.assetChartMode";

function getInitialChartMode(): ChartTypePref {
  // Wallet Asset Detail defaults to the clean line/area chart — candles are an
  // opt-in secondary mode. We only honour a saved preference once the user has
  // manually switched; with no saved value we default to "line".
  try {
    const saved = window.localStorage.getItem(CHART_MODE_STORAGE_KEY);
    if (saved === "line" || saved === "candles") return saved;
  } catch {
    // localStorage is optional.
  }
  return "line";
}

// Canonical network name from the chain registry (single source of truth).
const getNetworkLabel = getNetworkDisplayName;

function getPortfolioCacheKey(accountAddress: string, chainId: number): string {
  return `simple:portfolio:${chainId}:${accountAddress.toLowerCase()}`;
}

function isValuationCurrency(value: string | null): value is ValuationCurrency {
  return value === "USD" || value === "USDT" || value === "EUR";
}

function getInitialValuationCurrency(): ValuationCurrency {
  try {
    const saved = window.localStorage.getItem(VALUATION_STORAGE_KEY);

    if (isValuationCurrency(saved)) {
      return saved;
    }
  } catch {
    // localStorage is optional.
  }

  return "USD";
}

function readCachedPortfolio(cacheKey: string): CachedPortfolio | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);

    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedPortfolio;

    if (
      !parsed ||
      typeof parsed.updatedAt !== "number" ||
      !Array.isArray(parsed.assets)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeCachedPortfolio(
  cacheKey: string,
  assets: WalletAssetBalance[],
): void {
  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        assets,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // Cache is optional.
  }
}

function isNativeAsset(asset: WalletAssetBalance): boolean {
  return asset.type === "native";
}

function getAssetKey(asset: WalletAssetBalance): string {
  return (asset.contractAddress ?? "").toLowerCase();
}

function canRemoveAsset(asset: WalletAssetBalance): boolean {
  return !isNativeAsset(asset) && asset.source === "custom";
}

function truncateAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function getExplorerBaseUrl(chainId: number): string | null {
  return getChainById(chainId)?.blockExplorerUrl ?? null;
}

// Explorer URLs differ by family: TronScan uses hash routes (/#/address,
// /#/token20) while EVM explorers use /address and /token.
function getExplorerAddressUrl(chainId: number, address: string): string | null {
  if (isTronChainId(chainId)) {
    return `https://tronscan.org/#/address/${address}`;
  }

  // Solscan uses /account/<addr> and a ?cluster=devnet query for devnet.
  if (isSolanaChainId(chainId)) {
    const cluster =
      chainId === SOLANA_DEVNET_CHAIN_ID ? "?cluster=devnet" : "";
    return `https://solscan.io/account/${address}${cluster}`;
  }

  // Tonviewer accepts the user-friendly address verbatim at the root path.
  if (isTonChainId(chainId)) {
    return `https://tonviewer.com/${address}`;
  }

  const base = getExplorerBaseUrl(chainId);
  return base ? `${base}/address/${address}` : null;
}

function getExplorerTokenUrl(
  chainId: number,
  contractAddress: string,
): string | null {
  if (isTronChainId(chainId)) {
    return `https://tronscan.org/#/token20/${contractAddress}`;
  }

  // SPL mints live at solscan.io/token/<mint>.
  if (isSolanaChainId(chainId)) {
    const cluster =
      chainId === SOLANA_DEVNET_CHAIN_ID ? "?cluster=devnet" : "";
    return `https://solscan.io/token/${contractAddress}${cluster}`;
  }

  // TON Jetton master pages live at the Tonviewer root path.
  if (isTonChainId(chainId)) {
    return `https://tonviewer.com/${contractAddress}`;
  }

  const base = getExplorerBaseUrl(chainId);
  return base ? `${base}/token/${contractAddress}` : null;
}

// Stable price identity for an ERC-20 asset: `${chainId}:${lowercaseAddress}`.
// Native assets return null (priced via nativeQuote instead).
function getTokenPriceKey(asset: WalletAssetBalance): string | null {
  if (!asset.contractAddress) return null;
  return `${asset.chainId}:${asset.contractAddress.toLowerCase()}`;
}

function formatAssetPrice(
  asset: WalletAssetBalance,
  nativeAsset: WalletAssetBalance | null,
  nativeQuote: NativeAssetQuote | null,
  usdToEurRate: number | null,
  currency: ValuationCurrency,
  tokenPrices: Record<string, number>,
): string {
  const priceUsd = getAssetUsdPrice(asset, nativeAsset, nativeQuote, tokenPrices);
  if (priceUsd === null) return t("common.noPrice");
  const formatted = formatValue(priceUsd, usdToEurRate, currency);
  if (formatted === "—") return t("common.noPrice");
  return `${formatted} / ${asset.symbol}`;
}

function getActivityDisplayAmount(
  item: TransactionHistoryItem,
  asset: WalletAssetBalance,
): string {
  if (item.direction === "swap") {
    if (
      item.swapToSymbol?.toLowerCase() === asset.symbol.toLowerCase() &&
      item.swapToAmount
    ) {
      return `+${item.swapToAmount} ${item.swapToSymbol}`;
    }
    if (item.swapFromAmount) {
      return `-${item.swapFromAmount} ${item.swapFromSymbol ?? asset.symbol}`;
    }
    return `${item.amount} ${item.assetSymbol}`;
  }
  const sign = item.direction === "receive" ? "+" : "-";
  return `${sign}${item.amount} ${item.assetSymbol}`;
}


function formatAssetBalance(asset: WalletAssetBalance): string {
  const value = Number(asset.formatted);

  if (!Number.isFinite(value)) return asset.formatted;
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";

  if (value < 1) {
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: asset.decimals === 6 ? 2 : 6,
  });
}

function formatFiatValue(value: number | null, currency: "USD" | "EUR"): string {
  if (value === null || !Number.isFinite(value)) return "—";

  // Tiny but non-zero amounts would round to "$0.00" and read as worthless —
  // show "<$0.01" instead so micro-balances/prices stay legible.
  if (value > 0 && value < 0.01) {
    const symbol = currency === "EUR" ? "€" : "$";
    return `<${symbol}0.01`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatStableValue(value: number | null, symbol: string): string {
  if (value === null || !Number.isFinite(value)) return `— ${symbol}`;

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })} ${symbol}`;
}

function formatValue(
  valueUsd: number | null,
  usdToEurRate: number | null,
  currency: ValuationCurrency,
): string {
  if (currency === "USD") {
    return formatFiatValue(valueUsd, "USD");
  }

  if (currency === "EUR") {
    if (valueUsd === null || usdToEurRate === null) return "—";
    return formatFiatValue(valueUsd * usdToEurRate, "EUR");
  }

  return formatStableValue(valueUsd, currency);
}

function isStableSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase();

  return normalized === "USDT" || normalized === "USDC" || normalized === "DAI";
}

function getAssetUsdValue(
  asset: WalletAssetBalance,
  nativeAsset: WalletAssetBalance | null,
  nativeValueUsd: number | null,
  tokenPrices: Record<string, number>,
): number | null {
  if (nativeAsset && asset.id === nativeAsset.id) {
    return nativeValueUsd;
  }

  if (typeof asset.usdValue === "number" && Number.isFinite(asset.usdValue)) {
    return asset.usdValue;
  }

  const amount = Number(asset.formatted);

  if (typeof asset.usdPrice === "number" && Number.isFinite(asset.usdPrice)) {
    if (Number.isFinite(amount)) {
      return amount * asset.usdPrice;
    }
  }

  // Resolved ERC-20 spot price by chainId + contract address.
  const key = getTokenPriceKey(asset);
  if (key) {
    const price = tokenPrices[key];
    if (typeof price === "number" && Number.isFinite(price) && Number.isFinite(amount)) {
      return amount * price;
    }
  }

  if (isStableSymbol(asset.symbol)) {
    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return null;
}

// Compact USD for large market figures: $1.2B / $842.5M / $12.4K / $123.
// Returns "—" for missing / non-positive values (we never show "No volume").
function formatCompactUsd(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";

  const tiers: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [base, suffix] of tiers) {
    if (value >= base) {
      const scaled = value / base;
      return `$${scaled.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return `$${Math.round(value)}`;
}

function getAssetUsdPrice(
  asset: WalletAssetBalance,
  nativeAsset: WalletAssetBalance | null,
  nativeQuote: NativeAssetQuote | null,
  tokenPrices: Record<string, number>,
): number | null {
  if (nativeAsset && asset.id === nativeAsset.id) {
    return nativeQuote?.priceUsd ?? null;
  }

  if (typeof asset.usdPrice === "number" && Number.isFinite(asset.usdPrice)) {
    return asset.usdPrice;
  }

  // Resolved ERC-20 spot price by chainId + contract address.
  const key = getTokenPriceKey(asset);
  if (key) {
    const price = tokenPrices[key];
    if (typeof price === "number" && Number.isFinite(price)) {
      return price;
    }
  }

  if (isStableSymbol(asset.symbol)) {
    return 1;
  }

  return null;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"
        fill="none"
        stroke="currentColor"
      />
      <path
        d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A8.6 8.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8.6 8.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5z"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function Icon({
  name,
}: {
  name: "send" | "receive" | "swap" | "history" | "plus" | "wallet";
}) {
  if (name === "send") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 17L17 7" fill="none" stroke="currentColor" />
        <path d="M9 7h8v8" fill="none" stroke="currentColor" />
      </svg>
    );
  }

  if (name === "receive") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17 7L7 17" fill="none" stroke="currentColor" />
        <path d="M15 17H7V9" fill="none" stroke="currentColor" />
      </svg>
    );
  }

  if (name === "swap") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10l-3-3" fill="none" stroke="currentColor" />
        <path d="M17 17H7l3 3" fill="none" stroke="currentColor" />
        <path d="M17 7l-3 3" fill="none" stroke="currentColor" />
        <path d="M7 17l3-3" fill="none" stroke="currentColor" />
      </svg>
    );
  }

  if (name === "history") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 2.3-5.7" fill="none" stroke="currentColor" />
        <path d="M4 5v5h5" fill="none" stroke="currentColor" />
        <path d="M12 8v5l3 2" fill="none" stroke="currentColor" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="5"
        y="6"
        width="14"
        height="12"
        rx="3"
        fill="none"
        stroke="currentColor"
      />
      <path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" />
    </svg>
  );
}

export function HomePage(props: HomePageProps) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<WalletAssetBalance[]>([]);
  const [nativeQuote, setNativeQuote] = useState<NativeAssetQuote | null>(null);
  // Resolved ERC-20 spot prices (USD), keyed `${chainId}:${lowercaseAddress}`.
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  // Whether the first price lookup for the current chain has completed. Lets
  // AssetDetails show "Loading…" rather than a premature "No price".
  const [nativePriceDone, setNativePriceDone] = useState(false);
  const [tokenPricesDone, setTokenPricesDone] = useState(false);
  const [valuationCurrency, setValuationCurrency] =
    useState<ValuationCurrency>(getInitialValuationCurrency);
  const [isValuationSelectorOpen, setIsValuationSelectorOpen] = useState(false);
  const [isNetworkSelectorOpen, setIsNetworkSelectorOpen] = useState(false);
  const [hiddenAddresses, setHiddenAddresses] = useState<string[]>(() =>
    hiddenAssetService.getHiddenAddresses(props.walletState.selectedChainId),
  );
  const [assetDetails, setAssetDetails] = useState<WalletAssetBalance | null>(null);
  // Price chart (AssetDetailsPage). Hidden when no history is available.
  // Both datasets are fetched per asset/range so the user can toggle chart type
  // instantly. `chartMode` is the user's persisted *preference*; the rendered
  // type is resolved against what data is actually available (see resolvedMode).
  const [chartRange, setChartRange] = useState<PriceHistoryRange>("7D");
  const [chartPoints, setChartPoints] = useState<ChartPoint[] | null>(null);
  const [chartCandles, setChartCandles] = useState<CandlePoint[] | null>(null);
  const [chartMode, setChartMode] = useState<ChartTypePref>(
    getInitialChartMode,
  );
  const [chartStatus, setChartStatus] = useState<
    "idle" | "loading" | "ready" | "empty"
  >("idle");

  function selectChartMode(mode: ChartTypePref) {
    setChartMode(mode);
    try {
      window.localStorage.setItem(CHART_MODE_STORAGE_KEY, mode);
    } catch {
      // Persistence is optional.
    }
  }
  // Market data (24h change + 24h volume) for the open asset. Independent of
  // the chart so volume can show even when history is unavailable.
  const [marketData, setMarketData] = useState<AssetMarketData | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [isAssetsManagerOpen, setIsAssetsManagerOpen] = useState(false);
  const [assetHistory, setAssetHistory] = useState<TransactionHistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [portfolioStatus, setPortfolioStatus] =
    useState<PortfolioStatus>("idle");
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [, setUpdatedAt] = useState<number | null>(null);
  // Gateway resolver verdict per chain (chainId → includeInTotalBalance). It can
  // only *tighten* the local mainnet allowlist (countsTowardTotalBalance), never
  // loosen it, so an unreachable gateway falls back safely to the local guard.
  const [inclusionOverrides, setInclusionOverrides] = useState<
    Record<number, boolean>
  >({});

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const assetsRef = useRef<WalletAssetBalance[]>([]);
  // Guards against overlapping refreshes (Try again pressed while a scheduled
  // retry/auto-refresh is already running, focus/visibility re-entry, etc.).
  const syncInFlightRef = useRef(false);

  const selectedAddress = props.selectedAccount?.address ?? null;
  const selectedChainId = props.walletState.selectedChainId;

  const nativeAsset = assets.find((asset) => asset.type === "native") ?? null;
  const nativeAmount = nativeAsset ? Number(nativeAsset.formatted) : 0;

  const nativeValueUsd =
    nativeQuote && Number.isFinite(nativeAmount)
      ? nativeAmount * nativeQuote.priceUsd
      : null;

  // USD→EUR rate from the native quote (both prices come from the gateway).
  // EUR normally resolves; if it is ever missing the rate is null and the EUR
  // toggle shows "—" rather than implying USD parity.
  const usdToEurRate =
    nativeQuote &&
    nativeQuote.priceUsd > 0 &&
    typeof nativeQuote.priceEur === "number" &&
    Number.isFinite(nativeQuote.priceEur)
      ? nativeQuote.priceEur / nativeQuote.priceUsd
      : null;

  const refreshSeconds =
    props.walletState.settings.balanceAutoRefreshSeconds ??
    DEFAULT_BALANCE_REFRESH_SECONDS;

  const refreshMs = Math.max(1, refreshSeconds) * 1000;

  const cacheKey =
    selectedAddress !== null
      ? getPortfolioCacheKey(selectedAddress, selectedChainId)
      : null;

  function updateAssets(nextAssets: WalletAssetBalance[]) {
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
  }

  function clearTimers() {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  function scheduleRetry() {
    if (!mountedRef.current) return;

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }

    const delay =
      PORTFOLIO_RETRY_DELAYS_MS[
        Math.min(
          retryAttemptRef.current,
          PORTFOLIO_RETRY_DELAYS_MS.length - 1,
        )
      ];

    retryAttemptRef.current += 1;

    retryTimerRef.current = window.setTimeout(() => {
      void syncPortfolio();
    }, delay);
  }

  function scheduleRegularRefresh() {
    if (!mountedRef.current) return;

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      void syncPortfolio();
    }, refreshMs);
  }

  async function syncPortfolio() {
    if (!props.selectedAccount || !cacheKey) return;

    // Never run two refreshes at once — a second caller is a no-op while one is
    // in flight (the running one will repaint the UI when it settles).
    if (syncInFlightRef.current) {
      balanceLog("refresh skipped — already in flight");
      return;
    }
    syncInFlightRef.current = true;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setPortfolioStatus(assetsRef.current.length > 0 ? "syncing" : "loading");
    setPortfolioError(null);

    const startedAt = Date.now();
    const hadCache = assetsRef.current.length > 0;
    if (BALANCE_DEBUG) {
      console.groupCollapsed("[balances] refresh start");
      console.log("account", props.selectedAccount?.label ?? null);
      console.log("chainId", selectedChainId);
      console.log("address", selectedAddress);
      console.log("cachedAssets", assetsRef.current.length);
      console.groupEnd();
    }

    try {
      const result = await walletService.getSelectedPortfolio();

      if (!mountedRef.current || requestIdRef.current !== requestId) {
        balanceLog("refresh result ignored (stale/unmounted)", { requestId });
        return;
      }

      const nextUpdatedAt = Date.now();

      updateAssets(result.assets);
      setUpdatedAt(nextUpdatedAt);
      setPortfolioStatus("fresh");
      setPortfolioError(null);

      balanceLog("refresh success", {
        chainId: selectedChainId,
        assets: result.assets.length,
        durationMs: Date.now() - startedAt,
      });

      // Keep an open Asset Detail in sync with the fresh portfolio balance so it
      // never shows a stale 0 after a successful refresh (the detail holds its
      // own snapshot of the asset). Balance/labels come from the fresh asset;
      // an in-session enriched logo is preserved if the fresh one lacks it.
      setAssetDetails((prev) => {
        if (!prev) return prev;
        const fresh = result.assets.find((a) => a.id === prev.id);
        if (!fresh) return prev;
        return {
          ...prev,
          balanceRaw: fresh.balanceRaw,
          formatted: fresh.formatted,
          decimals: fresh.decimals,
          name: fresh.name,
          symbol: fresh.symbol,
          usdPrice: fresh.usdPrice,
          usdValue: fresh.usdValue,
          logoUrl: fresh.logoUrl ?? prev.logoUrl,
        };
      });

      retryAttemptRef.current = 0;

      writeCachedPortfolio(cacheKey, result.assets);

      if (import.meta.env.DEV) {
        // Q12: the SPL assets persisted to the selected-portfolio cache.
        console.debug("[SolanaPortfolioDebug] cached portfolio SPL assets", {
          assets: result.assets
            .filter((a) => a.type === "spl")
            .map((a) => ({
              id: a.id,
              mint: a.contractAddress,
              symbol: a.symbol,
              balanceRaw: a.balanceRaw,
              formatted: a.formatted,
            })),
        });
      }

      scheduleRegularRefresh();
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;

      // Critical only when nothing usable is on screen (no cache → "error").
      // With cached/partial data present we degrade to "stale" so the UI keeps
      // showing balances and surfaces a soft note, not the scary red banner.
      const status = hadCache ? "stale" : "error";

      setPortfolioError(error instanceof Error ? error.message : String(error));
      setPortfolioStatus(status);

      if (BALANCE_DEBUG) {
        console.groupCollapsed("[balances] refresh failed");
        console.log("stage", "getSelectedPortfolio");
        console.log("chainId", selectedChainId);
        console.log("address", selectedAddress);
        console.log("hadCache", hadCache);
        console.log("status", status);
        console.log("durationMs", Date.now() - startedAt);
        console.log("error", describeError(error));
        console.groupEnd();
      }

      scheduleRetry();
    } finally {
      syncInFlightRef.current = false;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    requestIdRef.current += 1;
    retryAttemptRef.current = 0;
    clearTimers();

    if (!cacheKey) {
      updateAssets([]);
      setUpdatedAt(null);
      setPortfolioStatus("idle");
      setPortfolioError(null);
      return;
    }

    const cached = readCachedPortfolio(cacheKey);

    if (cached) {
      updateAssets(cached.assets);
      setUpdatedAt(cached.updatedAt);
      setPortfolioStatus("stale");
      setPortfolioError(null);
    } else {
      updateAssets([]);
      setUpdatedAt(null);
      setPortfolioStatus("idle");
      setPortfolioError(null);
    }

    void syncPortfolio();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      clearTimers();
    };
  }, [cacheKey, selectedChainId]);

  useEffect(() => {
    let active = true;
    setNativePriceDone(false);

    if (!nativeAsset) {
      setNativeQuote(null);
      setNativePriceDone(true);
      return () => {
        active = false;
      };
    }

    const cached = nativePriceService.getCachedNativeQuote(selectedChainId);

    if (cached) {
      setNativeQuote(cached);
    }

    void nativePriceService
      .getNativeQuote({
        chainId: selectedChainId,
        symbol: nativeAsset.symbol,
      })
      .then((quote) => {
        if (!active) return;
        if (quote) setNativeQuote(quote);
      })
      .finally(() => {
        if (active) setNativePriceDone(true);
      });

    return () => {
      active = false;
    };
  }, [selectedChainId, nativeAsset?.symbol]);

  // Defence-in-depth: ask the Simpl API resolver whether this chain's native
  // asset may count toward the real portfolio total. The local mainnet
  // allowlist already excludes every testnet; this only ever *removes* a chain
  // the gateway flags as non-includable, and is a no-op when offline.
  useEffect(() => {
    let active = true;
    void resolveAsset({ chainId: selectedChainId, address: null }).then(
      (resolution) => {
        if (!active || !resolution) return;
        const include = resolution.includeInTotalBalance;
        if (typeof include !== "boolean") return;
        setInclusionOverrides((prev) =>
          prev[selectedChainId] === include
            ? prev
            : { ...prev, [selectedChainId]: include },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [selectedChainId]);

  // Resolve ERC-20 spot prices for the visible tokens on this chain, by
  // chainId + contract address (not symbol). Seeds from cache for instant
  // display, then refreshes. Merges into tokenPrices keyed `${chainId}:${addr}`.
  useEffect(() => {
    let active = true;
    setTokenPricesDone(false);

    const addresses = assets
      .filter(
        (asset) =>
          // Contract-addressed market tokens: EVM ERC-20/BEP-20 and Solana SPL
          // (e.g. imported GIGA/TROLL). The gateway prices them by chainId +
          // address; unknown ones simply come back without a price.
          (asset.type === "erc20" || asset.type === "spl") &&
          asset.contractAddress &&
          asset.chainId === selectedChainId,
      )
      .map((asset) => asset.contractAddress as string);

    if (addresses.length === 0) {
      setTokenPricesDone(true);
      return () => {
        active = false;
      };
    }

    function merge(map: Record<string, { priceUsd: number }>) {
      setTokenPrices((prev) => {
        const next = { ...prev };
        for (const [addr, price] of Object.entries(map)) {
          next[`${selectedChainId}:${addr}`] = price.priceUsd;
        }
        return next;
      });
    }

    const cached = tokenPriceService.getCachedTokenPrices(
      selectedChainId,
      addresses,
    );
    if (Object.keys(cached).length > 0) {
      merge(cached);
    }

    void tokenPriceService
      .getTokenPrices({ chainId: selectedChainId, addresses })
      .then((map) => {
        if (active) merge(map);
      })
      .finally(() => {
        if (active) setTokenPricesDone(true);
      });

    return () => {
      active = false;
    };
  }, [assets, selectedChainId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VALUATION_STORAGE_KEY, valuationCurrency);
    } catch {
      // localStorage is optional.
    }
  }, [valuationCurrency]);

  useEffect(() => {
    if (!isValuationSelectorOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsValuationSelectorOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isValuationSelectorOpen]);

  useEffect(() => {
    if (!isNetworkSelectorOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsNetworkSelectorOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isNetworkSelectorOpen]);

  useEffect(() => {
    setHiddenAddresses(hiddenAssetService.getHiddenAddresses(selectedChainId));
  }, [selectedChainId]);

  useEffect(() => {
    if (!assetDetails) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmHide) {
          setConfirmHide(false);
        } else if (confirmRemove) {
          setConfirmRemove(false);
        } else {
          setAssetDetails(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetDetails, confirmRemove, confirmHide]);

  useEffect(() => {
    if (!isAssetsManagerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsAssetsManagerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAssetsManagerOpen]);

  useEffect(() => {
    if (!assetDetails || !props.selectedAccount) {
      setAssetHistory([]);
      return;
    }
    const allItems = transactionHistoryService.listByAddresses([
      props.selectedAccount.address,
      "tronAddress" in props.selectedAccount
        ? props.selectedAccount.tronAddress
        : null,
      "solanaAddress" in props.selectedAccount
        ? props.selectedAccount.solanaAddress
        : null,
    ]);
    const assetSymbol = assetDetails.symbol.toLowerCase();
    const filtered = allItems
      .filter((item) => item.chainId === assetDetails.chainId)
      .filter((item) => {
        // Swap entries carry per-leg mints (swapFromMint/swapToMint) for
        // non-EVM swaps. Match by mint first — symbols collide across tokens.
        // Symbol matching is a last resort, used only when the entry has no
        // mint info (e.g. EVM swaps, which keep the original symbol-based path).
        const swapFromMint = item.swapFromMint?.toLowerCase();
        const swapToMint = item.swapToMint?.toLowerCase();
        const hasSwapMintInfo = swapFromMint != null || swapToMint != null;
        const matchesSwapSymbol =
          item.swapFromSymbol?.toLowerCase() === assetSymbol ||
          item.swapToSymbol?.toLowerCase() === assetSymbol;

        if (assetDetails.type === "native") {
          // Native SOL swaps reference the wrapped-SOL mint on their leg.
          const nativeMint = SOL_WSOL_MINT.toLowerCase();
          const matchesNativeMint =
            swapFromMint === nativeMint || swapToMint === nativeMint;
          return (
            item.assetType === "native" ||
            matchesNativeMint ||
            (!hasSwapMintInfo && matchesSwapSymbol)
          );
        }

        if (!assetDetails.contractAddress) return false;
        const mint = assetDetails.contractAddress.toLowerCase();
        return (
          item.contractAddress?.toLowerCase() === mint ||
          swapFromMint === mint ||
          swapToMint === mint ||
          (!hasSwapMintInfo && matchesSwapSymbol)
        );
      })
      .slice(0, 5);
    setAssetHistory(filtered);
    setCopied(false);
  }, [assetDetails?.id, props.selectedAccount?.address]);

  // Load chart data for the open asset / selected range, all via the gateway.
  // We fetch BOTH real OHLC candles (/v1/prices/ohlc) and line history
  // (/v1/prices/history) in parallel so the user can toggle Line/Candles with no
  // refetch. Candles and line are kept independent — we never synthesize candles
  // from line points or vice-versa. Native assets AND tokens (incl. stablecoins)
  // get a chart whenever the backend returns data; no client-side allow-list.
  // Neither dataset available → "empty" (graceful "Chart unavailable").
  useEffect(() => {
    if (!assetDetails) return;

    let active = true;
    const isNative = isNativeAsset(assetDetails);
    const address = isNative ? null : assetDetails.contractAddress ?? null;
    const range = chartRange;

    // Only requirement: a resolvable asset (native, or a token with an address).
    if (!isNative && !address) {
      setChartPoints(null);
      setChartCandles(null);
      setChartStatus("empty");
      return;
    }

    const backendRange =
      range === "1D" ? "1d" : range === "7D" ? "7d" : "1m";

    setChartStatus("loading");
    // Candle availability is range-specific. Drop the previous range's candles
    // and points up-front so a range with no candles can never show the prior
    // range's data or leave its Line/Candles toggle visible while loading.
    setChartCandles(null);
    setChartPoints(null);

    void (async () => {
      const [ohlc, points] = await Promise.all([
        // Real OHLC candles. Empty/unavailable just means no candle mode — no
        // fake candles are ever synthesized.
        getPriceOhlc({
          chainId: assetDetails.chainId,
          address,
          range: backendRange,
        }),
        // Line/area history.
        priceHistoryService.getAssetPriceHistory({
          chainId: assetDetails.chainId,
          address,
          range,
        }),
      ]);
      if (!active) return;

      const candles = ohlc?.candles;
      const nextCandles =
        Array.isArray(candles) && candles.length >= 2
          ? candles.map((c) => ({
              t: c.t,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }))
          : null;
      const nextPoints =
        points && points.length >= 2
          ? points.map((p) => ({ t: p.timestamp, price: p.price }))
          : null;

      setChartCandles(nextCandles);
      setChartPoints(nextPoints);
      setChartStatus(nextCandles || nextPoints ? "ready" : "empty");

      // Dev-only chart diagnostics (no-op in production). The toggle renders
      // whenever we have >= 2 candles — `hasCandles` here mirrors that gate.
      const hasCandles = nextCandles !== null;
      priceDebug("asset chart", {
        symbol: assetDetails.symbol,
        chainId: assetDetails.chainId,
        address: address ?? "native",
        range: backendRange,
        ohlcUrl: `/v1/prices/ohlc?chainId=${toBackendChainId(assetDetails.chainId)}&address=${address ?? "native"}&range=${backendRange}&vs=usd`,
        source: ohlc?.source ?? null,
        candles: ohlc?.candles?.length ?? 0,
        historyPoints: nextPoints?.length ?? 0,
        hasCandles,
        chartMode,
        toggleRendered: hasCandles,
        isTestnet: getChainById(assetDetails.chainId)?.isTestnet ?? false,
      });
    })();

    return () => {
      active = false;
    };
  }, [assetDetails?.id, chartRange]);

  // Load 24h volume / change for the open asset. Uses the shared price identity
  // (same provider id as spot + chart). Cached data shows instantly while a
  // fresh value loads; "—" only when no data exists. Never blocks the screen.
  useEffect(() => {
    if (!assetDetails) return;

    let active = true;
    const isNative = isNativeAsset(assetDetails);
    const address = isNative ? null : assetDetails.contractAddress ?? null;
    const marketInput = { chainId: assetDetails.chainId, address };

    // Instant paint from cache (may be stale), then refresh.
    const cached = marketDataService.getCachedAssetMarketData(marketInput);
    if (cached) setMarketData(cached);

    void marketDataService.getAssetMarketData(marketInput).then((data) => {
      if (!active) return;
      // Keep cached values rather than wiping to null on a transient failure.
      if (data) setMarketData(data);
    });

    return () => {
      active = false;
    };
  }, [assetDetails?.id]);

  // Backfill a missing logo for an imported Solana SPL token's detail view. The
  // portfolio maps known/stored metadata synchronously; tokens imported before
  // logo support — or whose logo wasn't reachable at import — arrive with
  // logoUrl === null. When such a token's detail opens we re-resolve metadata in
  // the background (best-effort, bounded by loadSplTokenMetadata's own budget),
  // update the live icon + list row, and persist the logo so it survives reload.
  // Stale results are dropped via `active` when the asset changes (EVM/TRON and
  // tokens that already have a logo are skipped entirely).
  useEffect(() => {
    const asset = assetDetails;
    if (!asset || isNativeAsset(asset)) return;
    if (!isSolanaChainId(asset.chainId) || asset.logoUrl) return;
    const mint = asset.contractAddress;
    if (!mint) return;

    let active = true;
    const assetId = asset.id;
    const nameWasFallback = asset.name === "Solana Token";

    void (async () => {
      try {
        const config = getRequiredSolanaConfigByChainId(asset.chainId);
        const meta = await loadSplTokenMetadata(config, mint);
        if (!active) return;

        const logoUrl = meta.logoUrl;
        const name = nameWasFallback && meta.name ? meta.name : null;
        const symbol = nameWasFallback && meta.symbol ? meta.symbol : null;
        if (!logoUrl && !name && !symbol) return; // nothing new resolved

        const patch = {
          ...(logoUrl ? { logoUrl } : {}),
          ...(name ? { name } : {}),
          ...(symbol ? { symbol } : {}),
        };

        // Live update: detail card.
        setAssetDetails((prev) =>
          prev && prev.id === assetId ? { ...prev, ...patch } : prev,
        );
        // Live update: list row + cache, so the logo shows on close/reload too.
        const nextAssets = assetsRef.current.map((a) =>
          a.id === assetId ? { ...a, ...patch } : a,
        );
        updateAssets(nextAssets);
        if (cacheKey) writeCachedPortfolio(cacheKey, nextAssets);
        // Persist to the custom-token store (no-op for non-imported tokens), so
        // the backfilled logo survives a fresh portfolio fetch.
        customTokenService.updateTokenMetadata({
          chainId: asset.chainId,
          address: mint,
          ...(logoUrl ? { logoURI: logoUrl } : {}),
          ...(name ? { name } : {}),
          ...(symbol ? { symbol } : {}),
        });
      } catch (error) {
        // Best-effort — a missing logo is never a user-facing error.
        console.debug("Solana asset-detail logo enrichment failed:", error);
      }
    })();

    return () => {
      active = false;
    };
  }, [assetDetails?.id]);

  function handleOpenAssetDetails(asset: WalletAssetBalance) {
    setAssetDetails(asset);
    setConfirmRemove(false);
    setConfirmHide(false);
    setChartRange("7D");
    setChartPoints(null);
    setChartCandles(null);
    // Keep the user's persisted Line/Candles preference across assets.
    setChartStatus("idle");
    setMarketData(null);
  }

  function handleCloseAssetDetails() {
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
  }

  async function handleCopyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available in this context
    }
  }

  function handleSendFromDetails(asset: WalletAssetBalance) {
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
    props.onSendAsset(asset);
  }

  function handleSwapFromDetails() {
    // Preselect this asset as the receive/TO token on the swap screen.
    const asset = assetDetails;
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
    props.onSwap(asset ?? undefined);
  }

  function handleReceiveFromDetails(asset: WalletAssetBalance) {
    // Open Receive with this asset preselected (works for watch-only too).
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
    props.onReceive(asset);
  }

  function handleHideAsset(asset: WalletAssetBalance) {
    if (!asset.contractAddress) return;
    hiddenAssetService.hideAsset(asset.chainId, asset.contractAddress);
    setHiddenAddresses(hiddenAssetService.getHiddenAddresses(selectedChainId));
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
  }

  function handleConfirmRemoveAsset(asset: WalletAssetBalance) {
    if (!asset.contractAddress) return;
    customTokenService.removeToken({ chainId: asset.chainId, address: asset.contractAddress });
    hiddenAssetService.hideAsset(asset.chainId, asset.contractAddress);
    setHiddenAddresses(hiddenAssetService.getHiddenAddresses(selectedChainId));
    const nextAssets = assets.filter((a) => a.id !== asset.id);
    updateAssets(nextAssets);
    if (cacheKey) writeCachedPortfolio(cacheKey, nextAssets);
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
  }

  function handleRestoreAsset(address: string) {
    hiddenAssetService.unhideAsset(selectedChainId, address);
    setHiddenAddresses(hiddenAssetService.getHiddenAddresses(selectedChainId));
  }

  async function handleSelectNetwork(chainId: number) {
    if (chainId === props.walletState.selectedChainId) {
      setIsNetworkSelectorOpen(false);
      return;
    }
    await walletService.setSelectedChainId(chainId);
    setIsNetworkSelectorOpen(false);
    await props.onRefresh();
  }

  if (!props.selectedAccount) {
    return (
      <div className="ext-popup" data-screen-label="03 Home">
        <div className="screen-body" style={{ padding: 24 }}>
          <div className="t-h2">{t("home.noSelectedAccount")}</div>

          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            {t("home.noSelectedAccountSub")}
          </p>

          <button
            className="btn primary lg full"
            type="button"
            onClick={props.onAccounts}
            style={{ marginTop: 20 }}
          >
            {t("home.chooseAccount")}
          </button>
        </div>
      </div>
    );
  }

  const isWatchOnlyAccount = isWatchOnly(props.selectedAccount);
  const hideBalances = props.walletState.settings.hideBalances;
  const hiddenAddressSet = new Set(hiddenAddresses);
  const visibleAssets = assets
    .filter((asset) => asset.visible)
    .filter((asset) => isNativeAsset(asset) || !hiddenAddressSet.has(getAssetKey(asset)));
  // Non-native assets (ERC-20 on EVM, TRC-20 on TRON) make up the token list.
  const tokenAssets = visibleAssets.filter((asset) => asset.type !== "native");

  const defaultSendAsset =
    nativeAsset ?? visibleAssets.find((asset) => asset.type !== "native") ?? null;

  // Only mainnet assets with real value count toward the total. Testnets/devnets
  // (Sepolia, BTC Testnet, Solana Devnet) may show a reference price/chart but
  // must NEVER inflate the portfolio total. The local mainnet allowlist is the
  // authoritative guard; the gateway resolver can further exclude a chain.
  function countsInTotal(chainId: number): boolean {
    if (!countsTowardTotalBalance(chainId)) return false;
    return inclusionOverrides[chainId] !== false;
  }

  const totalKnownValueUsd = visibleAssets.reduce((sum, asset) => {
    if (!countsInTotal(asset.chainId)) return sum;
    const value = getAssetUsdValue(asset, nativeAsset, nativeValueUsd, tokenPrices);

    return value === null ? sum : sum + value;
  }, 0);

  const hasKnownValue = visibleAssets.some((asset) => {
    return (
      countsInTotal(asset.chainId) &&
      getAssetUsdValue(asset, nativeAsset, nativeValueUsd, tokenPrices) !== null
    );
  });

  const totalValueText = hasKnownValue
    ? formatValue(totalKnownValueUsd, usdToEurRate, valuationCurrency)
    : "—";

  const isSyncing =
    portfolioStatus === "loading" || portfolioStatus === "syncing";

  const hiddenAssetObjects = assets.filter(
    (a) => !isNativeAsset(a) && hiddenAddressSet.has(getAssetKey(a)),
  );

  // Network selection — the shared full-screen selector (no modal/sheet).
  // Back returns to Home unchanged; selecting switches the global network.
  if (isNetworkSelectorOpen) {
    return (
      <SelectNetworkPage
        purpose="active"
        selectedChainId={props.walletState.selectedChainId}
        onSelect={(chainId) => void handleSelectNetwork(chainId)}
        onBack={() => setIsNetworkSelectorOpen(false)}
      />
    );
  }

  // Value currency — full wallet screen (replaces the old floating modal).
  // Rendered in place of Home while open; selecting saves the currency and
  // returns to Home. Persistence + formatting stay here via onSelect.
  if (isValuationSelectorOpen) {
    return (
      <ValueCurrencyPage
        selected={valuationCurrency}
        onSelect={(currency) => {
          setValuationCurrency(currency);
          setIsValuationSelectorOpen(false);
        }}
        onBack={() => setIsValuationSelectorOpen(false)}
      />
    );
  }

  // Manage assets — full wallet screen (replaces the old bottom sheet). Rendered
  // in place of Home while open; back returns to Home unchanged. Add-token and
  // hidden-asset restore logic stay here and are passed down as callbacks.
  if (isAssetsManagerOpen) {
    return (
      <ManageAssetsPage
        chainId={selectedChainId}
        hiddenAssets={hiddenAssetObjects}
        onAddCustomToken={() => {
          setIsAssetsManagerOpen(false);
          props.onAddCustomToken();
        }}
        onRestore={handleRestoreAsset}
        onBack={() => setIsAssetsManagerOpen(false)}
      />
    );
  }

  // Asset Details — full wallet screen (replaces the old modal). Rendered in
  // place of Home while an asset is selected; the back arrow clears it.
  if (assetDetails) {
    const asset = assetDetails;
    const isNative = isNativeAsset(asset);
    // Testnet/devnet native asset (BTC Testnet, Solana Devnet): price + chart
    // are shown for reference only and must not imply real portfolio value.
    // Testnets/devnets (Sepolia, BTC Testnet, Solana Devnet) show a reference
    // price but never imply real value — matched to the total-balance rule.
    const isReference = !countsTowardTotalBalance(asset.chainId);
    // True testnet/reference asset (Sepolia, BTC Testnet, Solana Devnet): it has
    // no real market of its own, so we never show a (borrowed) market chart or a
    // Swap action — just a clear notice. TRON mainnet is NOT a testnet.
    const isTestnetAsset = getChainById(asset.chainId)?.isTestnet ?? false;

    // Resolve which chart type actually renders: honour the user's preference
    // when the data exists, otherwise gracefully fall back to the other one.
    const candlesOk = (chartCandles?.length ?? 0) >= 2;
    const lineOk = (chartPoints?.length ?? 0) >= 2;
    const resolvedMode: "candles" | "area" =
      chartMode === "candles"
        ? candlesOk
          ? "candles"
          : "area"
        : lineOk
          ? "area"
          : "candles";

    // Chart change %: range start vs range end, from the rendered dataset.
    // Candles use the first candle's open and the last candle's close; line
    // history uses first vs last point.
    const chartFirst =
      resolvedMode === "candles" && chartCandles?.length
        ? chartCandles[0].open
        : chartPoints?.[0]?.price ?? null;
    const chartLast =
      resolvedMode === "candles" && chartCandles?.length
        ? chartCandles[chartCandles.length - 1].close
        : chartPoints && chartPoints.length > 0
          ? chartPoints[chartPoints.length - 1].price
          : null;
    const chartChangePct =
      chartFirst && chartLast && chartFirst !== 0
        ? ((chartLast - chartFirst) / chartFirst) * 100
        : null;
    const chartPositive = (chartChangePct ?? 0) >= 0;
    const showChartCard = chartStatus === "loading" || chartStatus === "ready";

    // 24h volume (market-wide, from the provider) + 24h change.
    const volume24hUsd = marketData?.volume24hUsd ?? null;
    const volume24hText = formatCompactUsd(volume24hUsd);
    const change24hPct = marketData?.priceChange24hPct ?? null;

    // Price stat: show "Loading…" only while a lookup we expect to succeed is
    // still pending. Unknown tokens fall straight through to "No price".
    const detailsAddress = isNative ? null : asset.contractAddress ?? null;
    const detailsPrice = getAssetUsdPrice(
      asset,
      nativeAsset,
      nativeQuote,
      tokenPrices,
    );
    const detailsPriceExpected =
      isKnownPriceAsset(asset.chainId, detailsAddress) ||
      isStableSymbol(asset.symbol);
    const detailsPriceDone = isNative ? nativePriceDone : tokenPricesDone;
    const detailsPriceLoading =
      detailsPrice === null && detailsPriceExpected && !detailsPriceDone;

    // When there's no chart (stablecoin or history unavailable) but the asset
    // still has a market identity, show a compact market card with the 24h
    // volume instead of an empty chart. Unknown tokens show neither.
    const showMarketFallback =
      !showChartCard &&
      chartStatus !== "idle" &&
      (detailsPriceExpected || detailsPrice != null || volume24hUsd != null);

    // No price, no history, no candles, no market identity: a truly unknown
    // imported token. Show a compact, reassuring "unavailable" notice instead of
    // a large empty chart card. Scoped to imported tokens — native assets always
    // resolve a market, so this never affects them.
    const showNoMarketData =
      !isNative &&
      !isTestnetAsset &&
      !showChartCard &&
      !showMarketFallback &&
      chartStatus !== "idle";

    // Swap is supported on EVM (0x proxy) and Solana (Simpl API / Jupiter,
    // SolanaSwapPage) — for native AND SPL/ERC-20 tokens. Other families (TRON,
    // BTC) have no token swap yet, so their imported tokens hide the action with
    // a short note. Native assets keep their existing behavior. Testnets never
    // swap.
    const swapFamily = getChainFamily(asset.chainId);
    const swapSupportedFamily = swapFamily === "evm" || swapFamily === "solana";
    // TRON has no SAME-chain swap, but TRON assets ARE usable as a CROSS-CHAIN
    // bridge SOURCE via LI.FI (BridgePage). Expose the Swap action for them too —
    // App routes a TRON Swap to the cross-chain bridge, never the 0x same-chain
    // flow (which would 400 for TRON).
    const isBridgeSource = isTronChainId(asset.chainId);
    // TON is receive-only in this MVP: no same-chain swap and no bridge route.
    const isTon = isTonChainId(asset.chainId);
    const swapAvailable =
      !isTestnetAsset &&
      !isTon &&
      (isNative || swapSupportedFamily || isBridgeSource);
    const showSwapUnavailableNote =
      !isNative &&
      !isTestnetAsset &&
      !isTon &&
      !swapAvailable &&
      !isWatchOnlyAccount;
    // Native TON send is supported; TON Jetton send is not (out of scope), so
    // hide Send for TON Jettons only. Every other chain keeps Send.
    const sendAvailable = !isTon || isNative;

    // Address label is chain-aware: Solana mints vs EVM/TRON contracts.
    const tokenAddressLabel = isSolanaChainId(asset.chainId)
      ? t("home.mintAddress")
      : t("home.contractAddress");

    return (
      <div className="ext-popup asset-details-page" data-screen-label="Asset">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={handleCloseAssetDetails}
            aria-label={t("common.back")}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>
          </button>

          <div className="asset-details-header-title">{t("home.assetHeader")}</div>

          <span style={{ flex: 1 }} />

          <span className="asset-details-network-pill">
            {getNetworkLabel(asset.chainId)}
          </span>
        </div>

        {confirmHide ? (
          <div className="asset-details-content">
            <div className="asset-remove-confirm">
              <div className="asset-remove-confirm-title">{t("home.hideAssetTitle")}</div>
              <div className="asset-remove-confirm-text">
                {t("home.hideAssetBody")}
              </div>
              <div className="asset-remove-confirm-buttons">
                <button
                  type="button"
                  className="asset-remove-btn asset-remove-btn--cancel"
                  onClick={() => setConfirmHide(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="asset-remove-btn asset-remove-btn--confirm"
                  onClick={() => handleHideAsset(asset)}
                >
                  {t("home.hideAsset")}
                </button>
              </div>
            </div>
          </div>
        ) : confirmRemove ? (
          <div className="asset-details-content">
            <div className="asset-remove-confirm">
              <div className="asset-remove-confirm-title">
                {t("home.removeTokenTitle")}
              </div>
              <div className="asset-remove-confirm-text">
                {t("home.removeTokenBody")}
              </div>
              <div className="asset-remove-confirm-buttons">
                <button
                  type="button"
                  className="asset-remove-btn asset-remove-btn--cancel"
                  onClick={() => setConfirmRemove(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="asset-remove-btn asset-remove-btn--confirm"
                  onClick={() => handleConfirmRemoveAsset(asset)}
                >
                  {t("home.removeToken")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="asset-details-content">
            {/* Hero */}
            <section className="asset-details-hero">
              <AssetIcon
                ticker={asset.symbol}
                logoURI={asset.logoUrl}
                address={asset.contractAddress}
                chainId={asset.chainId}
                size={48}
              />
              <div className="asset-details-hero__text">
                <div className="asset-details-hero__title">{asset.name}</div>
                <div className="asset-details-hero__sub">
                  {asset.symbol} · {getNetworkLabel(asset.chainId)}
                </div>
              </div>
            </section>

            {/* Stats: Balance / Price / Value */}
            <section className="asset-details-stats">
              <div className="asset-details-stat">
                <span className="asset-details-stat__label">{t("common.balance")}</span>
                <span className="asset-details-stat__value">
                  {hideBalances
                    ? "••••"
                    : `${formatAssetBalance(asset)} ${asset.symbol}`}
                </span>
              </div>
              <div className="asset-details-stat">
                <span className="asset-details-stat__label">
                  {isReference ? t("home.referencePrice") : t("common.price")}
                </span>
                <span className="asset-details-stat__value">
                  {detailsPriceLoading
                    ? t("common.loading")
                    : formatAssetPrice(
                        asset,
                        nativeAsset,
                        nativeQuote,
                        usdToEurRate,
                        valuationCurrency,
                        tokenPrices,
                      )}
                </span>
              </div>
              <div className="asset-details-stat">
                <span className="asset-details-stat__label">{t("common.value")}</span>
                <span className="asset-details-stat__value">
                  {hideBalances ? (
                    "••••••"
                  ) : isReference ? (
                    // Never imply real funds for testnet/devnet balances.
                    <span className="asset-details-stat__value--muted">
                      {t("home.notRealFunds")}
                    </span>
                  ) : (
                    formatValue(
                      getAssetUsdValue(
                        asset,
                        nativeAsset,
                        nativeValueUsd,
                        tokenPrices,
                      ),
                      usdToEurRate,
                      valuationCurrency,
                    )
                  )}
                </span>
              </div>
            </section>

            {isTestnetAsset ? (
              <div className="asset-reference-note">
                {t("home.testnetAssetNote")}
              </div>
            ) : null}

            {/* Price chart — when history is available. Header carries the
                selected-range change (left) and 24h volume (right). Testnet /
                reference assets never render a market chart. */}
            {!isTestnetAsset && showChartCard ? (
              <section className="asset-chart-card">
                <div className="asset-chart-head">
                  <div className="asset-chart-head__col">
                    <span className="asset-chart-title">
                      {t("common.price")}
                      {isReference ? (
                        <span className="asset-chart-ref-pill">{t("home.reference")}</span>
                      ) : null}
                    </span>
                    {chartStatus === "ready" && chartChangePct !== null ? (
                      <span
                        className={`asset-chart-change asset-chart-change--${
                          chartPositive ? "up" : "down"
                        }`}
                      >
                        {chartPositive ? "+" : ""}
                        {chartChangePct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="asset-chart-change asset-chart-change--muted">
                        {chartRange} change
                      </span>
                    )}
                  </div>

                  <div className="asset-chart-head__col asset-chart-head__col--right">
                    <span className="asset-chart-vol-label">{t("home.marketVolume24h")}</span>
                    <span className="asset-chart-vol-value">{volume24hText}</span>
                  </div>
                </div>

                <div className="asset-chart-body">
                  {chartStatus === "ready" && (chartPoints || chartCandles) ? (
                    <PriceChart
                      points={chartPoints ?? undefined}
                      candles={chartCandles ?? undefined}
                      mode={resolvedMode}
                      positive={chartPositive}
                      currency="usd"
                      height={210}
                    />
                  ) : (
                    <div className="asset-chart-loading">{t("home.loadingChart")}</div>
                  )}
                </div>

                {/* Range buttons: cleanly centered, on their own row. */}
                <div className="asset-chart-ranges">
                  {(["1D", "7D", "1M"] as PriceHistoryRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`asset-chart-range${
                        chartRange === range ? " asset-chart-range--active" : ""
                      }`}
                      onClick={() => setChartRange(range)}
                    >
                      {range}
                    </button>
                  ))}
                </div>

                {/* Chart type is a secondary/advanced control: only shown when
                    real OHLC candles exist for this asset/range. Line stays the
                    wallet default; selecting Line always uses /v1/prices/history
                    even when candles exist. Hidden entirely for line-only assets
                    (USDT/MNT/…) so it never competes with the range buttons. */}
                {candlesOk ? (
                  <div
                    className="asset-chart-type"
                    role="group"
                    aria-label={t("home.chartTypeLabel")}
                  >
                    <button
                      type="button"
                      className={`asset-chart-type-btn${
                        resolvedMode === "area" ? " asset-chart-type-btn--active" : ""
                      }`}
                      onClick={() => selectChartMode("line")}
                    >
                      {t("home.chartLine")}
                    </button>
                    <button
                      type="button"
                      className={`asset-chart-type-btn${
                        resolvedMode === "candles" ? " asset-chart-type-btn--active" : ""
                      }`}
                      onClick={() => selectChartMode("candles")}
                    >
                      {t("home.chartCandles")}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : !isTestnetAsset && showMarketFallback ? (
              // No chart (stablecoin / history unavailable) but the asset has a
              // market identity — show a compact market card, not an empty chart.
              <section className="asset-market-card">
                <div className="asset-market-card__row">
                  <span className="asset-market-card__label">{t("home.marketVolume24h")}</span>
                  <span className="asset-market-card__value">{volume24hText}</span>
                </div>
                {change24hPct !== null ? (
                  <div className="asset-market-card__row">
                    <span className="asset-market-card__label">{t("home.change24h")}</span>
                    <span
                      className={`asset-chart-change asset-chart-change--${
                        change24hPct >= 0 ? "up" : "down"
                      }`}
                    >
                      {change24hPct >= 0 ? "+" : ""}
                      {change24hPct.toFixed(2)}%
                    </span>
                  </div>
                ) : null}
                <div className="asset-market-card__note">{t("home.chartUnavailable")}</div>
              </section>
            ) : showNoMarketData ? (
              // Unknown imported token with no market data at all — keep it small
              // and calm, never a big blank chart card.
              <section className="asset-no-market">
                <div className="asset-no-market__title">
                  {t("home.marketDataUnavailable")}
                </div>
                <p className="asset-no-market__text">
                  {t("home.noPriceData")}
                </p>
                <p className="asset-no-market__sub">
                  {t("home.noPriceDataReassure")}
                </p>
              </section>
            ) : null}

            {/* Contract / native info */}
            {isNative ? (
              <section className="asset-details-info-card">
                <div className="asset-details-info-row">
                  <span className="asset-details-info-label">{t("home.assetTypeLabel")}</span>
                  <span className="asset-details-info-value">
                    {t("home.nativeNetworkAsset")}
                  </span>
                </div>
                <p className="asset-details-info-note">
                  {t("home.nativeAssetNote", { chain: getNetworkLabel(asset.chainId) })}
                </p>
                {(() => {
                  const nativeAddress = isTronChainId(asset.chainId)
                    ? props.selectedAccount &&
                      "tronAddress" in props.selectedAccount
                      ? props.selectedAccount.tronAddress ?? null
                      : null
                    : isBitcoinChainId(asset.chainId)
                      ? props.selectedAccount &&
                        "bitcoinAddresses" in props.selectedAccount
                        ? props.selectedAccount.bitcoinAddresses?.[asset.chainId]
                            ?.receive ?? null
                        : null
                      : isSolanaChainId(asset.chainId)
                        ? props.selectedAccount &&
                          "solanaAddress" in props.selectedAccount
                          ? props.selectedAccount.solanaAddress ?? null
                          : null
                        : isTonChainId(asset.chainId)
                          ? props.selectedAccount &&
                            "tonAddress" in props.selectedAccount
                            ? props.selectedAccount.tonAddress ?? null
                            : null
                          : selectedAddress;
                  const url = nativeAddress
                    ? getExplorerAddressUrl(asset.chainId, nativeAddress)
                    : null;
                  return url ? (
                    <a
                      className="asset-details-explorer-btn"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("home.viewAddressArrow")}
                    </a>
                  ) : null;
                })()}
              </section>
            ) : asset.contractAddress ? (
              <section className="asset-details-info-card">
                <div className="asset-details-info-row">
                  <span className="asset-details-info-label">
                    {tokenAddressLabel}
                  </span>
                  <span className="asset-details-info-value asset-details-info-address">
                    {truncateAddress(asset.contractAddress)}
                  </span>
                  <button
                    type="button"
                    className="asset-copy-btn"
                    onClick={() =>
                      void handleCopyAddress(asset.contractAddress!)
                    }
                    aria-label={`Copy ${tokenAddressLabel.toLowerCase()}`}
                  >
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
                {getExplorerTokenUrl(asset.chainId, asset.contractAddress) ? (
                  <a
                    className="asset-details-explorer-btn"
                    href={
                      getExplorerTokenUrl(asset.chainId, asset.contractAddress) ??
                      undefined
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("home.viewContractArrow")}
                  </a>
                ) : null}
              </section>
            ) : null}

            {/* Actions: Send / Receive / Swap */}
            {isWatchOnlyAccount ? (
              <>
                <div className="asset-details-actions asset-details-actions--single">
                  <button
                    type="button"
                    className="asset-action-btn asset-action-btn--primary"
                    onClick={() => handleReceiveFromDetails(asset)}
                  >
                    {t("home.receive")}
                  </button>
                </div>
                <p className="asset-details-watch-note">
                  {t("home.watchOnlyDisabled")}
                </p>
              </>
            ) : (
              <div className="asset-details-actions">
                {sendAvailable ? (
                  <button
                    type="button"
                    className="asset-action-btn asset-action-btn--primary"
                    onClick={() => handleSendFromDetails(asset)}
                  >
                    {t("home.send")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`asset-action-btn ${
                    sendAvailable
                      ? "asset-action-btn--outline"
                      : "asset-action-btn--primary"
                  }`}
                  onClick={() => handleReceiveFromDetails(asset)}
                >
                  {t("home.receive")}
                </button>
                {swapAvailable ? (
                  <button
                    type="button"
                    className="asset-action-btn asset-action-btn--outline"
                    onClick={handleSwapFromDetails}
                  >
                    {t("home.swap")}
                  </button>
                ) : null}
              </div>
            )}

            {showSwapUnavailableNote ? (
              <p className="asset-details-swap-note">
                {t("home.swapUnavailable", { chain: getNetworkLabel(asset.chainId) })}
              </p>
            ) : null}

            {/* Activity */}
            <section className="asset-details-activity">
              <div className="asset-details-activity-title">{t("home.activity")}</div>
              {assetHistory.length === 0 ? (
                <div className="asset-activity-empty">{t("activity.empty")}</div>
              ) : (
                <div className="asset-activity-list">
                  {assetHistory.map((item) => (
                    <div key={item.id} className="asset-activity-row">
                      <span className="asset-activity-type">
                        {item.direction === "swap"
                          ? t("home.swap")
                          : item.direction === "send"
                            ? t("home.send")
                            : t("home.receive")}
                      </span>
                      <span className="asset-activity-amount">
                        {getActivityDisplayAmount(item, asset)}
                      </span>
                      <span
                        className={`asset-activity-status asset-activity-status--${item.status}`}
                      >
                        {item.status === "submitted"
                          ? t("activity.status.pending")
                          : item.status === "confirmed"
                            ? t("activity.status.confirmed")
                            : t("activity.status.failed")}
                      </span>
                      {item.explorerUrl ? (
                        <a
                          className="asset-activity-link"
                          href={item.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("home.viewTransaction")}
                        >
                          ↗
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="asset-activity-view-all"
                onClick={() => {
                  handleCloseAssetDetails();
                  props.onHistory();
                }}
              >
                {t("home.viewAllActivity")} ›
              </button>
            </section>

            {/* Manage token — ERC-20 only. A quiet section at the very bottom so
                the destructive actions never dominate the screen. */}
            {!isNative ? (
              <section className="asset-details-manage">
                <div className="asset-details-manage-title">{t("home.manageToken")}</div>
                <div className="asset-details-secondary-actions">
                  <button
                    type="button"
                    className="asset-details-ghost-btn"
                    onClick={() => setConfirmHide(true)}
                  >
                    {t("home.hideAsset")}
                  </button>
                  {canRemoveAsset(asset) && (
                    <button
                      type="button"
                      className="asset-details-danger-btn"
                      onClick={() => setConfirmRemove(true)}
                    >
                      {t("home.removeImportedToken")}
                    </button>
                  )}
                </div>
                <div className="asset-details-view-note">
                  {t("home.manageTokenNote")}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ext-popup" data-screen-label="03 Home">
      <div className="bar-top">
        <button className="acct-chip" type="button" onClick={props.onAccounts}>
          <AccountBlockie address={props.selectedAccount.address} size={24} />
          <span className="acct-chip-label">{props.selectedAccount.label}</span>
          {isWatchOnlyAccount && (
            <span className="watch-only-badge">{t("accounts.watchOnly")}</span>
          )}
        </button>

        <span style={{ flex: 1 }} />

        <button
          className="net-chip"
          type="button"
          onClick={() => setIsNetworkSelectorOpen(true)}
          title={getNetworkLabel(props.walletState.selectedChainId)}
          aria-label={t("home.networkChipAria", {
            label: getNetworkLabel(props.walletState.selectedChainId),
          })}
        >
          <NetworkIcon chainId={props.walletState.selectedChainId} size={18} />
          <span className="net-chip-label">
            {getCompactNetworkName(props.walletState.selectedChainId)}
          </span>
        </button>

        <button className="icbtn" type="button" onClick={props.onSettings}>
          <SettingsIcon />
        </button>
      </div>

      <div className="screen-body">
        <div className="balance-block">
          <div className="lbl">{t("home.totalBalance")}</div>

          <button
            type="button"
            className="val val-clickable home-total-balance-trigger"
            onClick={() => setIsValuationSelectorOpen(true)}
            aria-label={t("home.changeValuationCurrency")}
            aria-haspopup="dialog"
          >
            <span className={`home-total-balance-value${isSyncing ? " home-total-balance-value--loading" : ""}`}>
              {hideBalances ? "••••••" : totalValueText}
            </span>
            <svg
              className="val-chevron home-total-balance-chevron"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

        </div>

        {!isWatchOnlyAccount && (
          <div className="actions">
            {/* Send sends the chain's native asset (defaultSendAsset) — native
                TON IS sendable. Swap stays hidden on TON (out of scope). */}
            <button
              className="action"
              type="button"
              onClick={() => {
                if (defaultSendAsset) props.onSendAsset(defaultSendAsset);
              }}
              disabled={!defaultSendAsset}
            >
              <SimpleInstrumentIcon instrument="send" iconSize={16} />
              <span className="a-lbl">{t("home.send")}</span>
            </button>

            <button
              className="action"
              type="button"
              onClick={() => props.onReceive()}
            >
              <SimpleInstrumentIcon instrument="receive" iconSize={16} />
              <span className="a-lbl">{t("home.receive")}</span>
            </button>

            {!isTonChainId(selectedChainId) ? (
              <button
                className="action"
                type="button"
                onClick={() => props.onSwap()}
              >
                <SimpleInstrumentIcon instrument="swap" iconSize={16} />
                <span className="a-lbl">{t("home.swap")}</span>
              </button>
            ) : null}
          </div>
        )}

        {(() => {
          const solana = isSolanaChainId(selectedChainId);
          const hardError = portfolioStatus === "error";
          const staleError =
            portfolioStatus === "stale" && portfolioError !== null;

          // Every chain now follows the same rule: the prominent red banner is
          // shown ONLY when nothing usable loaded (no cache → "error"). When
          // cached/partial balances are already on screen ("stale"), a transient
          // RPC/price/token failure is non-critical — keep the balances and show
          // a soft, non-alarming note with a silent background retry instead of
          // the scary "Couldn't refresh balances." banner.
          const showCriticalBanner = hardError;
          const showDegradedNote = staleError;

          if (showCriticalBanner) {
            return (
              <div
                style={{
                  margin: "0 12px 12px",
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span>
                  {solana
                    ? t("home.solanaUnavailable")
                    : t("home.couldntRefreshBalances")}
                </span>
                <button
                  type="button"
                  onClick={() => void syncPortfolio()}
                  disabled={isSyncing}
                  style={{
                    flexShrink: 0,
                    background: "transparent",
                    border: "1px solid currentColor",
                    borderRadius: 5,
                    color: "inherit",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 8px",
                    cursor: "pointer",
                    opacity: isSyncing ? 0.5 : 1,
                  }}
                >
                  {t("common.retry")}
                </button>
              </div>
            );
          }

          if (showDegradedNote) {
            // Soft note: small, neutral copy, no scary red, no prominent button.
            // A background retry is already scheduled and clears the note on
            // success. Cached balances stay on screen the whole time.
            return (
              <div className="home-degraded-note">
                {solana
                  ? t("home.solanaDegraded")
                  : t("home.balancesDegraded")}
              </div>
            );
          }

          return null;
        })()}

        <div className="sect-head">
          <div className="lbl">{t("home.assets")}</div>

          <div className="assets-header-actions">
            <button type="button" className="assets-header-action" onClick={props.onHistory}>
              <Icon name="history" />
              <span>{t("home.history")}</span>
            </button>

            {/* Arbitrary Jetton import isn't supported on TON (trusted-allowlist
                only), so don't expose an "+ Add token" action there. */}
            {!isTonChainId(selectedChainId) ? (
              <button
                className="link"
                type="button"
                onClick={() => setIsAssetsManagerOpen(true)}
              >
                + {t("home.addTokenShort")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="row-list">
          {visibleAssets.map((asset) => {
            const assetUsdValue = getAssetUsdValue(
              asset,
              nativeAsset,
              nativeValueUsd,
              tokenPrices,
            );

            const assetUsdPrice = getAssetUsdPrice(
              asset,
              nativeAsset,
              nativeQuote,
              tokenPrices,
            );

            return (
              <button
                key={asset.id}
                className="row"
                type="button"
                onClick={() => handleOpenAssetDetails(asset)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: 0,
                  textAlign: "left",
                }}
              >
                <AssetIcon
                  ticker={asset.symbol}
                  logoURI={asset.logoUrl}
                  address={asset.contractAddress}
                  chainId={asset.chainId}
                  size={44}
                />

                <div className="body">
                  <div className="nm">{asset.name}</div>

                  <div className="sub">
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      {hideBalances ? "••••" : formatAssetBalance(asset)} {asset.symbol}
                    </span>
                  </div>
                </div>

                <div className="num">
                  {hideBalances ? (
                    <div className="v">••••••</div>
                  ) : !countsTowardTotalBalance(asset.chainId) ? (
                    // Testnet/devnet: never imply real value. Show the reference
                    // price (when loaded) under a clear "Reference" tag.
                    assetUsdPrice !== null ? (
                      <>
                        <div className="v v--muted">{t("home.reference")}</div>
                        <div className="q">
                          {`${formatValue(
                            assetUsdPrice,
                            usdToEurRate,
                            valuationCurrency,
                          )}/${asset.symbol}`}
                        </div>
                      </>
                    ) : (
                      <div className="q q--muted">{t("home.referencePrice")}</div>
                    )
                  ) : assetUsdPrice !== null ? (
                    <>
                      <div className="v">
                        {formatValue(assetUsdValue, usdToEurRate, valuationCurrency)}
                      </div>
                      <div className="q">
                        {`${formatValue(
                          assetUsdPrice,
                          usdToEurRate,
                          valuationCurrency,
                        )}/${asset.symbol}`}
                      </div>
                    </>
                  ) : (
                    // No fiat price (e.g. TRX): show a single intentional
                    // "No price" instead of a lonely dash + label.
                    <div className="q q--muted">{t("common.noPrice")}</div>
                  )}
                </div>
              </button>
            );
          })}

          {tokenAssets.length === 0 &&
          !isTronChainId(selectedChainId) &&
          !isBitcoinChainId(selectedChainId) &&
          !isSolanaChainId(selectedChainId) &&
          !isTonChainId(selectedChainId) ? (
            <div
              style={{
                margin: "8px",
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--bg-surface)",
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {t("home.noErc20Balance")}
            </div>
          ) : null}
        </div>
      </div>

    </div>
  );
}

export default HomePage;