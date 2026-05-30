// src/popup/routes/HomePage.tsx

import { useEffect, useRef, useState } from "react";
import { SimpleInstrumentIcon } from "../components/SimpleInstrumentIcon";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkIcon } from "../components/NetworkIcon";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import {
  nativePriceService,
  type NativeAssetQuote,
} from "../../core/prices/native-price.service";
import { walletService } from "../../core/wallet/wallet.service";
import { customTokenService } from "../../core/tokens/custom-token.service";
import { hiddenAssetService } from "../../core/tokens/hidden-asset.service";

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

const CURRENCY_LABELS: Record<ValuationCurrency, string> = {
  USD: "US Dollar",
  USDT: "Tether USD",
  EUR: "Euro",
};

type HomePageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onAccounts: () => void;
  onReceive: () => void;
  onSwap: () => void;
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

const VALUATION_CURRENCIES: ValuationCurrency[] = ["USD", "USDT", "EUR"];

const VALUATION_STORAGE_KEY = "simple:nativeValuationCurrency";

const CHAIN_OPTIONS = [
  { chainId: 1, name: "Ethereum Mainnet", subtitle: "ETH · Chain 1" },
  { chainId: 56, name: "BNB Smart Chain", subtitle: "BNB · Chain 56" },
  { chainId: 8453, name: "Base", subtitle: "ETH · Chain 8453" },
  { chainId: 11155111, name: "Sepolia", subtitle: "ETH · Chain 11155111" },
];

function getNetworkLabel(chainId: number): string {
  if (chainId === 1) return "Ethereum";
  if (chainId === 56) return "BNB Chain";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";

  return `Chain ${chainId}`;
}

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


function formatUpdatedAt(updatedAt: number | null): string {
  if (!updatedAt) return "Not synced yet";

  const diffSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));

  if (diffSeconds < 10) return "Updated just now";
  if (diffSeconds < 60) return `Updated ${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;

  return `Updated ${Math.floor(diffMinutes / 60)}h ago`;
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
): number | null {
  if (nativeAsset && asset.id === nativeAsset.id) {
    return nativeValueUsd;
  }

  if (typeof asset.usdValue === "number" && Number.isFinite(asset.usdValue)) {
    return asset.usdValue;
  }

  if (typeof asset.usdPrice === "number" && Number.isFinite(asset.usdPrice)) {
    const amount = Number(asset.formatted);

    if (Number.isFinite(amount)) {
      return amount * asset.usdPrice;
    }
  }

  if (isStableSymbol(asset.symbol)) {
    const amount = Number(asset.formatted);

    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return null;
}

function getAssetUsdPrice(
  asset: WalletAssetBalance,
  nativeAsset: WalletAssetBalance | null,
  nativeQuote: NativeAssetQuote | null,
): number | null {
  if (nativeAsset && asset.id === nativeAsset.id) {
    return nativeQuote?.priceUsd ?? null;
  }

  if (typeof asset.usdPrice === "number" && Number.isFinite(asset.usdPrice)) {
    return asset.usdPrice;
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

function CurrencyIcon({ currency }: { currency: ValuationCurrency }) {
  const configs: Record<ValuationCurrency, { bg: string; color: string; symbol: string }> = {
    USD:  { bg: "#FEF9C3", color: "#CA8A04", symbol: "$" },
    USDT: { bg: "#DCFCE7", color: "#16A34A", symbol: "₮" },
    EUR:  { bg: "#EEF2FF", color: "#4F46E5", symbol: "€" },
  };
  const { bg, color, symbol } = configs[currency];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 10,
        background: bg,
        color,
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {symbol}
    </span>
  );
}

export function HomePage(props: HomePageProps) {
  const [assets, setAssets] = useState<WalletAssetBalance[]>([]);
  const [nativeQuote, setNativeQuote] = useState<NativeAssetQuote | null>(null);
  const [valuationCurrency, setValuationCurrency] =
    useState<ValuationCurrency>(getInitialValuationCurrency);
  const [isValuationSelectorOpen, setIsValuationSelectorOpen] = useState(false);
  const [isNetworkSelectorOpen, setIsNetworkSelectorOpen] = useState(false);
  const [hiddenAddresses, setHiddenAddresses] = useState<string[]>(() =>
    hiddenAssetService.getHiddenAddresses(props.walletState.selectedChainId),
  );
  const [assetDetails, setAssetDetails] = useState<WalletAssetBalance | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [isAssetsManagerOpen, setIsAssetsManagerOpen] = useState(false);
  const [portfolioStatus, setPortfolioStatus] =
    useState<PortfolioStatus>("idle");
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const assetsRef = useRef<WalletAssetBalance[]>([]);

  const selectedAddress = props.selectedAccount?.address ?? null;
  const selectedChainId = props.walletState.selectedChainId;

  const nativeAsset = assets.find((asset) => asset.type === "native") ?? null;
  const nativeAmount = nativeAsset ? Number(nativeAsset.formatted) : 0;

  const nativeValueUsd =
    nativeQuote && Number.isFinite(nativeAmount)
      ? nativeAmount * nativeQuote.priceUsd
      : null;

  const usdToEurRate =
    nativeQuote && nativeQuote.priceUsd > 0
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

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setPortfolioStatus(assetsRef.current.length > 0 ? "syncing" : "loading");
    setPortfolioError(null);

    try {
      const result = await walletService.getSelectedPortfolio();

      if (!mountedRef.current || requestIdRef.current !== requestId) return;

      const nextUpdatedAt = Date.now();

      updateAssets(result.assets);
      setUpdatedAt(nextUpdatedAt);
      setPortfolioStatus("fresh");
      setPortfolioError(null);

      retryAttemptRef.current = 0;

      writeCachedPortfolio(cacheKey, result.assets);
      scheduleRegularRefresh();
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;

      setPortfolioError(error instanceof Error ? error.message : String(error));
      setPortfolioStatus(assetsRef.current.length > 0 ? "stale" : "error");

      scheduleRetry();
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

    if (!nativeAsset) {
      setNativeQuote(null);
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
        if (active && quote) {
          setNativeQuote(quote);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedChainId, nativeAsset?.symbol]);

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

  function handleOpenAssetDetails(asset: WalletAssetBalance) {
    setAssetDetails(asset);
    setConfirmRemove(false);
    setConfirmHide(false);
  }

  function handleCloseAssetDetails() {
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
  }

  function handleSendFromDetails(asset: WalletAssetBalance) {
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
    props.onSendAsset(asset);
  }

  function handleSwapFromDetails() {
    setAssetDetails(null);
    setConfirmRemove(false);
    setConfirmHide(false);
    props.onSwap();
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
          <div className="t-h2">No selected account</div>

          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            Choose an account to continue using SIMPLE.
          </p>

          <button
            className="btn primary lg full"
            type="button"
            onClick={props.onAccounts}
            style={{ marginTop: 20 }}
          >
            Choose account
          </button>
        </div>
      </div>
    );
  }

  const hideBalances = props.walletState.settings.hideBalances;
  const hiddenAddressSet = new Set(hiddenAddresses);
  const visibleAssets = assets
    .filter((asset) => asset.visible)
    .filter((asset) => isNativeAsset(asset) || !hiddenAddressSet.has(getAssetKey(asset)));
  const tokenAssets = visibleAssets.filter((asset) => asset.type === "erc20");

  const defaultSendAsset =
    nativeAsset ?? visibleAssets.find((asset) => asset.type === "erc20") ?? null;

  const totalKnownValueUsd = visibleAssets.reduce((sum, asset) => {
    const value = getAssetUsdValue(asset, nativeAsset, nativeValueUsd);

    return value === null ? sum : sum + value;
  }, 0);

  const hasKnownValue = visibleAssets.some((asset) => {
    return getAssetUsdValue(asset, nativeAsset, nativeValueUsd) !== null;
  });

  const totalValueText = hasKnownValue
    ? formatValue(totalKnownValueUsd, usdToEurRate, valuationCurrency)
    : "—";

  const isSyncing =
    portfolioStatus === "loading" || portfolioStatus === "syncing";

  const hiddenAssetObjects = assets.filter(
    (a) => !isNativeAsset(a) && hiddenAddressSet.has(getAssetKey(a)),
  );

  return (
    <div className="ext-popup" data-screen-label="03 Home">
      <div className="bar-top">
        <button className="acct-chip" type="button" onClick={props.onAccounts}>
          <span className="av" />
          {props.selectedAccount.label}
        </button>

        <span style={{ flex: 1 }} />

        <button className="net-chip" type="button" onClick={() => setIsNetworkSelectorOpen(true)}>
          <NetworkIcon chainId={props.walletState.selectedChainId} size={18} />
          {getNetworkLabel(props.walletState.selectedChainId)}
        </button>

        <button className="icbtn" type="button" onClick={props.onSettings}>
          <SettingsIcon />
        </button>
      </div>

      <div className="screen-body">
        <div className="balance-block">
          <div className="lbl">Total balance</div>

          <button
            type="button"
            className="val val-clickable home-total-balance-trigger"
            onClick={() => setIsValuationSelectorOpen(true)}
            aria-label="Change valuation currency"
            aria-haspopup="dialog"
          >
            <span className="home-total-balance-value">
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

          <div className="balance-toolbar">
            <div className="delta">
              {isSyncing ? "Syncing..." : formatUpdatedAt(updatedAt)}
            </div>
          </div>
        </div>

        <div className="actions">
          <button
            className="action"
            type="button"
            onClick={() => {
              if (defaultSendAsset) props.onSendAsset(defaultSendAsset);
            }}
            disabled={!defaultSendAsset}
          >
            <SimpleInstrumentIcon instrument="send" iconSize={16} />
            <span className="a-lbl">Send</span>
          </button>

          <button className="action" type="button" onClick={props.onReceive}>
            <SimpleInstrumentIcon instrument="receive" iconSize={16} />
            <span className="a-lbl">Receive</span>
          </button>

          <button className="action" type="button" onClick={props.onSwap}>
            <SimpleInstrumentIcon instrument="swap" iconSize={16} />
            <span className="a-lbl">Swap</span>
          </button>

          
        </div>

        {portfolioStatus === "error" && portfolioError ? (
          <div
            style={{
              margin: "0 12px 12px",
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--danger-soft)",
              color: "var(--danger)",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            Could not load assets yet. SIMPLE will try again in the background.
          </div>
        ) : null}

        <div className="sect-head">
          <div className="lbl">Assets</div>

          <div className="assets-header-actions">
            <button type="button" className="assets-header-action" onClick={props.onHistory}>
              <Icon name="history" />
              <span>History</span>
            </button>

            <button
              className="link"
              type="button"
              onClick={() => setIsAssetsManagerOpen(true)}
            >
              + Token
            </button>
          </div>
        </div>

        <div className="row-list">
          {visibleAssets.map((asset) => {
            const assetUsdValue = getAssetUsdValue(
              asset,
              nativeAsset,
              nativeValueUsd,
            );

            const assetUsdPrice = getAssetUsdPrice(
              asset,
              nativeAsset,
              nativeQuote,
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
                  <div className="v">
                    {hideBalances ? "••••••" : formatValue(assetUsdValue, usdToEurRate, valuationCurrency)}
                  </div>

                  <div className="q">
                    {assetUsdPrice !== null
                      ? `${formatValue(
                          assetUsdPrice,
                          usdToEurRate,
                          valuationCurrency,
                        )}/${asset.symbol}`
                      : "No price"}
                  </div>
                </div>
              </button>
            );
          })}

          {tokenAssets.length === 0 ? (
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
              No ERC-20 balance yet. USDT and USDC are tracked on supported
              networks. Custom tokens can be added manually.
            </div>
          ) : null}
        </div>
      </div>

      {isValuationSelectorOpen && (
        <div
          className="valuation-modal-backdrop"
          onClick={() => setIsValuationSelectorOpen(false)}
        >
          <div
            className="valuation-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Select value currency"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="valuation-modal-header">
              <div>
                <div className="valuation-modal-title">Select value currency</div>
                <div className="valuation-modal-subtitle">Choose how to display portfolio values.</div>
              </div>
              <button
                type="button"
                className="valuation-modal-close"
                onClick={() => setIsValuationSelectorOpen(false)}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="valuation-option-list">
              {VALUATION_CURRENCIES.map((currency) => (
                <button
                  key={currency}
                  type="button"
                  className={`valuation-option${currency === valuationCurrency ? " valuation-option--active" : ""}`}
                  onClick={() => {
                    setValuationCurrency(currency);
                    setIsValuationSelectorOpen(false);
                  }}
                >
                  <span className="valuation-option-icon">
                    <CurrencyIcon currency={currency} />
                  </span>
                  <span className="valuation-option-body">
                    <span className="valuation-option-code">{currency}</span>
                    <span className="valuation-option-name">{CURRENCY_LABELS[currency]}</span>
                  </span>
                  <span className="valuation-option-check">
                    {currency === valuationCurrency && (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L19 7" />
                      </svg>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {assetDetails && (
        <div
          className="asset-modal-backdrop"
          onClick={handleCloseAssetDetails}
        >
          <div
            className="asset-details-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Asset details"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="asset-details-modal-header">
              <AssetIcon
                ticker={assetDetails.symbol}
                logoURI={assetDetails.logoUrl}
                address={assetDetails.contractAddress}
                chainId={assetDetails.chainId}
                size={48}
              />
              <div className="asset-details-modal-info">
                <div className="asset-details-modal-name">{assetDetails.name}</div>
                <div className="asset-details-modal-symbol">{assetDetails.symbol}</div>
              </div>
              <button
                type="button"
                className="valuation-modal-close"
                onClick={handleCloseAssetDetails}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {confirmHide ? (
              <div className="asset-remove-confirm">
                <div className="asset-remove-confirm-title">Hide asset?</div>
                <div className="asset-remove-confirm-text">
                  This hides the token from your wallet view. You can show it again later from Manage assets. Your on-chain tokens are not moved or deleted.
                </div>
                <div className="asset-remove-confirm-buttons">
                  <button
                    type="button"
                    className="asset-remove-btn asset-remove-btn--cancel"
                    onClick={() => setConfirmHide(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="asset-remove-btn asset-remove-btn--confirm"
                    onClick={() => handleHideAsset(assetDetails)}
                  >
                    Hide asset
                  </button>
                </div>
              </div>
            ) : confirmRemove ? (
              <div className="asset-remove-confirm">
                <div className="asset-remove-confirm-title">Remove imported token?</div>
                <div className="asset-remove-confirm-text">
                  This removes the imported token record from this wallet. Your on-chain tokens are not moved or deleted. You can add the token again later by contract address.
                </div>
                <div className="asset-remove-confirm-buttons">
                  <button
                    type="button"
                    className="asset-remove-btn asset-remove-btn--cancel"
                    onClick={() => setConfirmRemove(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="asset-remove-btn asset-remove-btn--confirm"
                    onClick={() => handleConfirmRemoveAsset(assetDetails)}
                  >
                    Remove token
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="asset-details-modal-stats">
                  <div className="asset-details-modal-stat">
                    <span className="asset-details-modal-stat-label">Balance</span>
                    <span className="asset-details-modal-stat-value">
                      {hideBalances ? "••••" : `${formatAssetBalance(assetDetails)} ${assetDetails.symbol}`}
                    </span>
                  </div>
                  <div className="asset-details-modal-stat">
                    <span className="asset-details-modal-stat-label">Value</span>
                    <span className="asset-details-modal-stat-value">
                      {hideBalances
                        ? "••••••"
                        : formatValue(
                            getAssetUsdValue(assetDetails, nativeAsset, nativeValueUsd),
                            usdToEurRate,
                            valuationCurrency,
                          )}
                    </span>
                  </div>
                  {assetDetails.contractAddress && (
                    <div className="asset-details-modal-stat">
                      <span className="asset-details-modal-stat-label">Contract</span>
                      <span className="asset-details-modal-stat-value asset-details-modal-address">
                        {truncateAddress(assetDetails.contractAddress)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="asset-details-modal-primary-actions">
                  <button
                    type="button"
                    className="asset-details-modal-btn asset-details-modal-btn--primary"
                    onClick={() => handleSendFromDetails(assetDetails)}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className="asset-details-modal-btn asset-details-modal-btn--secondary"
                    onClick={handleSwapFromDetails}
                  >
                    Swap
                  </button>
                </div>

                {isNativeAsset(assetDetails) ? (
                  <div className="asset-details-native-note">
                    Native network asset cannot be removed.
                  </div>
                ) : (
                  <>
                    <div className="asset-details-modal-secondary-actions">
                      <button
                        type="button"
                        className="asset-details-modal-btn asset-details-modal-btn--ghost"
                        onClick={() => setConfirmHide(true)}
                      >
                        Hide asset
                      </button>
                      {canRemoveAsset(assetDetails) && (
                        <button
                          type="button"
                          className="asset-details-modal-btn asset-details-modal-btn--danger"
                          onClick={() => setConfirmRemove(true)}
                        >
                          Remove imported token
                        </button>
                      )}
                    </div>
                    <div className="asset-details-view-note">
                      This only changes your wallet view. Your on-chain tokens are not moved or deleted.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {isAssetsManagerOpen && (
        <div className="network-sheet-backdrop">
          <button
            type="button"
            className="network-sheet-scrim"
            aria-label="Close"
            onClick={() => setIsAssetsManagerOpen(false)}
          />
          <section className="network-sheet assets-mgr-sheet">
            <div className="network-sheet-head">
              <div>
                <div className="network-sheet-title">Manage assets</div>
                <div className="network-sheet-subtitle">Add tokens or restore hidden ones.</div>
              </div>
              <button
                type="button"
                className="icbtn"
                onClick={() => setIsAssetsManagerOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="row-list">
              <button
                type="button"
                className="row assets-mgr-add-row"
                onClick={() => {
                  setIsAssetsManagerOpen(false);
                  props.onAddCustomToken();
                }}
                style={{ width: "100%", background: "transparent", border: 0, textAlign: "left" }}
              >
                <span className="assets-mgr-add-icon">+</span>
                <div className="body">
                  <div className="nm">Add custom token</div>
                  <div className="sub">Import by contract address</div>
                </div>
                <div className="num">
                  <div className="v">›</div>
                </div>
              </button>

              {hiddenAssetObjects.length > 0 && (
                <>
                  <div className="assets-mgr-section-sep">Hidden assets</div>
                  {hiddenAssetObjects.map((asset) => (
                    <div
                      key={asset.id}
                      className="row"
                      style={{ cursor: "default" }}
                    >
                      <AssetIcon
                        ticker={asset.symbol}
                        logoURI={asset.logoUrl}
                        address={asset.contractAddress}
                        chainId={asset.chainId}
                        size={36}
                      />
                      <div className="body" style={{ opacity: 0.55 }}>
                        <div className="nm">{asset.name}</div>
                        <div className="sub">
                          {asset.symbol}
                          {asset.contractAddress
                            ? ` · ${truncateAddress(asset.contractAddress)}`
                            : ""}
                        </div>
                      </div>
                      <div className="num">
                        <button
                          type="button"
                          className="assets-mgr-restore-btn"
                          onClick={() => {
                            if (asset.contractAddress)
                              handleRestoreAsset(asset.contractAddress);
                          }}
                        >
                          Show
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {hiddenAssetObjects.length === 0 && (
                <div className="assets-mgr-empty">
                  No hidden assets on this network.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {isNetworkSelectorOpen && (
        <div className="network-sheet-backdrop">
          <button
            type="button"
            className="network-sheet-scrim"
            aria-label="Close network selector"
            onClick={() => setIsNetworkSelectorOpen(false)}
          />

          <section className="network-sheet">
            <div className="network-sheet-head">
              <div>
                <div className="network-sheet-title">Select network</div>
                <div className="network-sheet-subtitle">Choose active EVM network.</div>
              </div>

              <button
                type="button"
                className="icbtn"
                onClick={() => setIsNetworkSelectorOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="row-list">
              {CHAIN_OPTIONS.map((chain) => {
                const active = chain.chainId === props.walletState.selectedChainId;

                return (
                  <button
                    key={chain.chainId}
                    type="button"
                    className="row"
                    onClick={() => void handleSelectNetwork(chain.chainId)}
                    style={{
                      width: "100%",
                      border: 0,
                      background: active ? "var(--bg-sunken)" : "transparent",
                      textAlign: "left",
                    }}
                  >
                    <NetworkIcon chainId={chain.chainId} networkName={chain.name} size={36} />

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
      )}
    </div>
  );
}

export default HomePage;