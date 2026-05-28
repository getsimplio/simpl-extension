// src/popup/routes/SwapPage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import {
  getSimpleSwapFeeBps,
  getZeroXAllowanceSpender,
  getZeroXRouteLabel,
  getZeroXSwapPrice,
  getZeroXSwapQuote,
  hasZeroXAllowanceIssue,
  hasZeroXBalanceIssue,
  ZERO_X_NATIVE_TOKEN_ADDRESS,
  type ZeroXSwapPrice,
  type ZeroXSwapQuote,
} from "../../core/swap/zeroXSwapService";
import {
  getPancakeV2SwapPrice,
  getPancakeV2SwapQuote,
  isPancakeV2SupportedChain,
} from "../../core/swap/pancakeV2SwapService";

import { transactionHistoryService } from "../../core/transactions/transaction-history.service";
import { walletService } from "../../core/wallet/wallet.service";
import "./SwapPage.css";

type SwapPageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onBack: () => void;
  onSwapCompleted?: () => void | Promise<void>;
};

type SwapToken = {
  id: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  type: WalletAssetBalance["type"];
  address: string;
  iconText: string;
};

type TokenPickerSide = "from" | "to";
type PriceStatus = "idle" | "loading" | "ready" | "error";
type ReviewStatus = "idle" | "loading" | "ready" | "error";
type SubmitStatus = "idle" | "submitting" | "submitted" | "error";
type ApprovalStatus = "idle" | "approving" | "approved" | "error";


type SwapTransactionReceipt = {
  status?: string | number | boolean | null;
};

const SWAP_RECEIPT_RPC_URLS: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};

async function getSwapTransactionReceipt(
  chainId: number,
  hash: string,
): Promise<SwapTransactionReceipt | null> {
  const rpcUrl = SWAP_RECEIPT_RPC_URLS[chainId];

  if (!rpcUrl) {
    throw new Error(`Receipt watcher RPC is not configured for chain ${chainId}.`);
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "eth_getTransactionReceipt",
      params: [hash],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: SwapTransactionReceipt | null;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "RPC receipt request failed.");
  }

  return payload.result ?? null;
}


type SubmittedSwapStatus = "pending" | "confirmed" | "failed";

const SLIPPAGE_STORAGE_KEY = "simple:swapSlippageBps";
const DEFAULT_SLIPPAGE_BPS = 50;
const MIN_SLIPPAGE_BPS = 1;
const MAX_SLIPPAGE_BPS = 1000;
const SIMPLE_SWAP_FEE_RECIPIENT = (import.meta.env.VITE_SIMPLE_SWAP_FEE_RECIPIENT ?? "").trim();

function clampSlippageBps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SLIPPAGE_BPS;

  return Math.min(
    MAX_SLIPPAGE_BPS,
    Math.max(MIN_SLIPPAGE_BPS, Math.trunc(value)),
  );
}

function getInitialSlippageBps(): number {
  try {
    const raw = window.localStorage.getItem(SLIPPAGE_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_SLIPPAGE_BPS;
    }

    return clampSlippageBps(Number(raw));
  } catch {
    return DEFAULT_SLIPPAGE_BPS;
  }
}


type SwapPriceRequest = {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker: string;
};

type SwapQuoteRequest = SwapPriceRequest & {
  slippageBps?: number;
  swapFeeRecipient?: string;
  swapFeeBps?: number;
  swapFeeToken?: string;
};

async function getSwapPriceWithFallback(
  params: SwapPriceRequest,
): Promise<ZeroXSwapPrice> {
  try {
    return await getZeroXSwapPrice(params);
  } catch (zeroXError) {
    if (!isPancakeV2SupportedChain(params.chainId)) {
      throw zeroXError;
    }

    try {
      return await getPancakeV2SwapPrice(params);
    } catch (pancakeError) {
      throw new Error(
        `${normalizeSwapError(zeroXError, "quote")} PancakeSwap V2 fallback also failed: ${normalizeSwapError(
          pancakeError,
          "quote",
        )}`,
      );
    }
  }
}

async function getSwapQuoteWithFallback(
  params: SwapQuoteRequest,
): Promise<ZeroXSwapQuote> {
  try {
    return await getZeroXSwapQuote(params);
  } catch (zeroXError) {
    if (!isPancakeV2SupportedChain(params.chainId)) {
      throw zeroXError;
    }

    try {
      return await getPancakeV2SwapQuote(params);
    } catch (pancakeError) {
      throw new Error(
        `${normalizeSwapError(zeroXError, "quote")} PancakeSwap V2 fallback also failed: ${normalizeSwapError(
          pancakeError,
          "quote",
        )}`,
      );
    }
  }
}

function formatSlippageBps(value: number): string {
  return `${(value / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}%`;
}

function parseSlippagePercentInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");

  if (!normalized) return null;

  const percent = Number(normalized);

  if (!Number.isFinite(percent) || percent <= 0) {
    return null;
  }

  return clampSlippageBps(percent * 100);
}


type AssetWithPossibleAddress = WalletAssetBalance & {
  address?: string;
  contractAddress?: string;
  tokenAddress?: string;
  contract?: string;
};

function getNetworkLabel(chainId: number): string {
  if (chainId === 1) return "Ethereum";
  if (chainId === 56) return "BNB Chain";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";

  return `Chain ${chainId}`;
}

function getTokenIconText(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();

  if (normalized === "ETH") return "Ξ";
  if (normalized === "BNB") return "B";
  if (normalized === "USDC") return "$";
  if (normalized === "USDT") return "₮";
  if (normalized === "DAI") return "D";

  return normalized.slice(0, 1) || "?";
}

function getAssetAddress(asset: WalletAssetBalance): string {
  if (asset.type === "native") {
    return ZERO_X_NATIVE_TOKEN_ADDRESS;
  }

  const assetWithAddress = asset as AssetWithPossibleAddress;

  return (
    assetWithAddress.address ??
    assetWithAddress.contractAddress ??
    assetWithAddress.tokenAddress ??
    assetWithAddress.contract ??
    ""
  );
}

function assetToSwapToken(asset: WalletAssetBalance): SwapToken {
  return {
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    balance: asset.formatted,
    decimals: asset.decimals,
    type: asset.type,
    address: getAssetAddress(asset),
    iconText: getTokenIconText(asset.symbol),
  };
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

function formatTokenBalance(value: string): string {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return value;
  if (numericValue === 0) return "0";
  if (numericValue < 0.000001) return "<0.000001";

  if (numericValue < 1) {
    return numericValue.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  return numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

function sanitizeAmountInput(value: string): string {
  const normalized = value.replace(",", ".");

  let result = "";
  let hasDot = false;

  for (const char of normalized) {
    if (char >= "0" && char <= "9") {
      result += char;
      continue;
    }

    if (char === "." && !hasDot) {
      hasDot = true;
      result += char;
    }
  }

  return result;
}

function parseDecimalUnits(value: string, decimals: number): string | null {
  const normalized = value.trim();

  if (!normalized || normalized === ".") {
    return null;
  }

  if (!/^\d*(\.\d*)?$/.test(normalized)) {
    return null;
  }

  const [wholeRaw, fractionRaw = ""] = normalized.split(".");
  const whole = wholeRaw || "0";
  const fraction = fractionRaw.slice(0, decimals).padEnd(decimals, "0");
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";

  try {
    return BigInt(digits).toString();
  } catch {
    return null;
  }
}

function formatUnits(value: string | undefined, decimals: number): string {
  if (!value) return "—";

  try {
    const raw = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const fraction = raw % base;

    if (fraction === 0n) {
      return whole.toLocaleString("en-US");
    }

    const fractionText = fraction
      .toString()
      .padStart(decimals, "0")
      .slice(0, 6)
      .replace(/0+$/, "");

    return `${whole.toLocaleString("en-US")}.${fractionText}`;
  } catch {
    return "—";
  }
}

function formatEstimatedReceive(
  price: ZeroXSwapPrice | null,
  toToken: SwapToken | null,
): string {
  if (!price || !toToken) return "—";

  return formatUnits(price.buyAmount, toToken.decimals);
}

function getFeeTokenSymbol(
  feeTokenAddress: string,
  fromToken: SwapToken | null,
  toToken: SwapToken | null,
): string {
  const normalizedAddress = feeTokenAddress.toLowerCase();

  if (fromToken?.address.toLowerCase() === normalizedAddress) {
    return fromToken.symbol;
  }

  if (toToken?.address.toLowerCase() === normalizedAddress) {
    return toToken.symbol;
  }

  return "token";
}

function getFeeTokenDecimals(
  feeTokenAddress: string,
  fromToken: SwapToken | null,
  toToken: SwapToken | null,
): number {
  const normalizedAddress = feeTokenAddress.toLowerCase();

  if (fromToken?.address.toLowerCase() === normalizedAddress) {
    return fromToken.decimals;
  }

  if (toToken?.address.toLowerCase() === normalizedAddress) {
    return toToken.decimals;
  }

  return 18;
}

function formatSimpleFeeAmount(
  price: ZeroXSwapPrice | null,
  fromToken: SwapToken | null,
  toToken: SwapToken | null,
): string {
  const fee = price?.fees?.integratorFee;

  if (!fee || !fee.amount || !fee.token) {
    return "—";
  }

  const decimals = getFeeTokenDecimals(fee.token, fromToken, toToken);
  const symbol = getFeeTokenSymbol(fee.token, fromToken, toToken);
  const amount = formatUnits(fee.amount, decimals);

  if (amount === "—") {
    return "—";
  }

  return `${amount} ${symbol}`;
}

function formatMinReceived(
  price: ZeroXSwapPrice | null,
  toToken: SwapToken | null,
): string {
  if (!price || !toToken) return "—";

  const value = formatUnits(price.minBuyAmount, toToken.decimals);

  if (value === "—") return value;

  return `${value} ${toToken.symbol}`;
}

function formatNetworkFee(price: ZeroXSwapPrice | null): string {
  if (!price?.totalNetworkFee) return "—";

  try {
    if (BigInt(price.totalNetworkFee) <= 0n) {
      return "—";
    }
  } catch {
    return "—";
  }

  const value = formatUnits(price.totalNetworkFee, 18);

  if (value === "—" || value.startsWith("-") || value === "0") {
    return "—";
  }

  return `~${value}`;
}

function formatBps(bps: number): string {
  return (bps / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatRate(
  price: ZeroXSwapPrice | null,
  fromToken: SwapToken | null,
  toToken: SwapToken | null,
): string {
  if (!price || !fromToken || !toToken) return "—";

  const sellAmount = Number(formatUnits(price.sellAmount, fromToken.decimals));
  const buyAmount = Number(formatUnits(price.buyAmount, toToken.decimals));

  if (
    !Number.isFinite(sellAmount) ||
    !Number.isFinite(buyAmount) ||
    sellAmount <= 0
  ) {
    return "—";
  }

  const rate = buyAmount / sellAmount;

  return `1 ${fromToken.symbol} ≈ ${rate.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  })} ${toToken.symbol}`;
}



function getSubmittedSwapStatusTitle(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return "Swap confirmed";
  if (status === "failed") return "Swap failed";
  return "Swap submitted";
}

function getSubmittedSwapStatusSubtitle(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return "Confirmed on-chain";
  if (status === "failed") return "Transaction failed on-chain";
  return "Waiting for network confirmation";
}

function getSubmittedSwapStatusLabel(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "failed") return "Failed";
  return "Pending";
}

function getSubmittedSwapStatusCardTitle(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return "Transaction confirmed";
  if (status === "failed") return "Transaction failed";
  return "Transaction sent";
}

function getSubmittedSwapStatusCardText(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return "Your swap has been confirmed by the network.";
  if (status === "failed") return "The transaction was included on-chain but failed.";
  return "Your swap has been submitted to the network.";
}

function getSubmittedSwapStatusIcon(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return "✓";
  if (status === "failed") return "!";
  return "↗";
}


type SwapErrorContext = "quote" | "approval" | "submit" | "receipt" | "unknown";

function normalizeSwapError(error: unknown, context: SwapErrorContext): string {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);

  const message = rawMessage.toLowerCase();

  if (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("action rejected") ||
    message.includes("rejected the request") ||
    message.includes("code 4001") ||
    message.includes('"code":4001') ||
    message.includes("4001")
  ) {
    return "Transaction rejected in wallet.";
  }

  if (
    message.includes("insufficient funds") ||
    message.includes("insufficient balance") ||
    message.includes("not enough") ||
    message.includes("exceeds balance")
  ) {
    return "Insufficient balance for this swap and network fee.";
  }

  if (
    message.includes("execution reverted") ||
    message.includes("transaction reverted") ||
    message.includes("reverted") ||
    message.includes("call exception")
  ) {
    return "Transaction reverted on-chain. Your tokens were not swapped, but a network fee may still be charged.";
  }

  if (
    message.includes("failed to fetch") ||
    message.includes("network error") ||
    message.includes("timeout") ||
    message.includes("rpc") ||
    message.includes("temporarily unavailable") ||
    message.includes("service unavailable")
  ) {
    return "Network or RPC is temporarily unavailable. Please try again in a few seconds.";
  }

  if (
    message.includes("allowance") ||
    message.includes("approve") ||
    message.includes("approval")
  ) {
    return "Token approval failed. Please try approving the token again.";
  }

  if (
    context === "quote" ||
    message.includes("0x") ||
    message.includes("quote") ||
    message.includes("liquidity") ||
    message.includes("swap api")
  ) {
    return "0x quote failed. Try changing the amount, token pair, network, or slippage.";
  }

  if (context === "approval") {
    return "Approval failed. Please try again or check your wallet.";
  }

  if (context === "submit") {
    return "Swap transaction failed. Please check your wallet and try again.";
  }

  if (context === "receipt") {
    return "Could not check transaction status. The transaction may still be pending.";
  }

  return rawMessage || "Something went wrong. Please try again.";
}


function formatShortTransactionHash(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function encodeAddressForAbi(address: string): string {
  const cleanAddress = stripHexPrefix(address).toLowerCase();

  if (!/^[0-9a-f]{40}$/.test(cleanAddress)) {
    throw new Error("Invalid approval spender address.");
  }

  return cleanAddress.padStart(64, "0");
}

function encodeUint256ForAbi(value: string): string {
  const bigintValue = BigInt(value);

  if (bigintValue < 0n) {
    throw new Error("Approval amount cannot be negative.");
  }

  return bigintValue.toString(16).padStart(64, "0");
}

function encodeErc20ApproveData(spender: string, amount: string): string {
  const approveSelector = "095ea7b3";

  return `0x${approveSelector}${encodeAddressForAbi(spender)}${encodeUint256ForAbi(
    amount,
  )}`;
}

function sortSwapTokens(tokens: SwapToken[]): SwapToken[] {
  return [...tokens].sort((a, b) => {
    if (a.type === "native" && b.type !== "native") return -1;
    if (a.type !== "native" && b.type === "native") return 1;

    const priority = ["ETH", "BNB", "USDC", "USDT", "DAI"];
    const aIndex = priority.indexOf(a.symbol.toUpperCase());
    const bIndex = priority.indexOf(b.symbol.toUpperCase());

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.symbol.localeCompare(b.symbol);
  });
}

export function SwapPage({
  selectedAccount,
  walletState,
  onBack,
  onSwapCompleted,
}: SwapPageProps) {
  const [tokens, setTokens] = useState<SwapToken[]>([]);
  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState("");
  const hideBalances = readHideBalancesSetting();
  const [tokenPickerSide, setTokenPickerSide] =
    useState<TokenPickerSide | null>(null);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [slippageBps, setSlippageBps] = useState<number>(
    getInitialSlippageBps,
  );
  const [customSlippagePercent, setCustomSlippagePercent] = useState(
    () => String(DEFAULT_SLIPPAGE_BPS / 100),
  );
  const [isSwapSettingsOpen, setIsSwapSettingsOpen] = useState(false);

  const [priceStatus, setPriceStatus] = useState<PriceStatus>("idle");
  const [price, setPrice] = useState<ZeroXSwapPrice | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const priceRequestIdRef = useRef(0);

  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("idle");
  const [quote, setQuote] = useState<ZeroXSwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedTxHash, setSubmittedTxHash] = useState<string | null>(null);
  const [submittedExplorerUrl, setSubmittedExplorerUrl] = useState<string | null>(
    null,
  );
  const [submittedSwapStatus, setSubmittedSwapStatus] =
    useState<SubmittedSwapStatus>("pending");
  const [submittedSwapError, setSubmittedSwapError] = useState<string | null>(null);


  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("idle");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalTxHash, setApprovalTxHash] = useState<string | null>(null);

  const selectedChainId = walletState.selectedChainId;
  const simpleSwapFeeBps = getSimpleSwapFeeBps();

  useEffect(() => {
    try {
      window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, String(slippageBps));
    } catch {
      // localStorage is optional.
    }
  }, [slippageBps]);

  useEffect(() => {
    let active = true;

    async function loadTokens() {
      setIsLoadingTokens(true);
      setTokenError(null);

      try {
        const portfolio = await walletService.getSelectedPortfolio();

        if (!active) return;

        const nextTokens = sortSwapTokens(
          portfolio.assets
            .filter((asset) => asset.visible)
            .map(assetToSwapToken)
            .filter((token) => token.type === "native" || Boolean(token.address)),
        );

        setTokens(nextTokens);

        setFromToken((current) => {
          if (current && nextTokens.some((token) => token.id === current.id)) {
            return current;
          }

          return (
            nextTokens.find((token) => token.type === "native") ??
            nextTokens[0] ??
            null
          );
        });

        setToToken((current) => {
          if (current && nextTokens.some((token) => token.id === current.id)) {
            return current;
          }

          const stableToken = nextTokens.find((token) => {
            const symbol = token.symbol.toUpperCase();
            return symbol === "USDC" || symbol === "USDT" || symbol === "DAI";
          });

          return (
            stableToken ??
            nextTokens.find((token) => token.type !== "native") ??
            null
          );
        });
      } catch (error) {
        if (!active) return;

        setTokenError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) {
          setIsLoadingTokens(false);
        }
      }
    }

    void loadTokens();

    return () => {
      active = false;
    };
  }, [selectedAccount?.address, selectedChainId]);

  const sellAmountBaseUnits = useMemo(() => {
    if (!fromToken) return null;

    return parseDecimalUnits(amount, fromToken.decimals);
  }, [amount, fromToken]);

  useEffect(() => {
    priceRequestIdRef.current += 1;

    const requestId = priceRequestIdRef.current;

    setPrice(null);
    setPriceError(null);

    if (
      !selectedAccount ||
      !fromToken ||
      !toToken ||
      fromToken.id === toToken.id ||
      !sellAmountBaseUnits ||
      sellAmountBaseUnits === "0"
    ) {
      setPriceStatus("idle");
      return;
    }

    if (!fromToken.address || !toToken.address) {
      setPriceStatus("error");
      setPriceError("Token address is missing for swap quote.");
      return;
    }

    setPriceStatus("loading");

    const timeoutId = window.setTimeout(() => {
      void getSwapPriceWithFallback({
        chainId: selectedChainId,
        sellToken: fromToken.address,
        buyToken: toToken.address,
        sellAmount: sellAmountBaseUnits,
        taker: selectedAccount.address,
      })
        .then((nextPrice) => {
          if (priceRequestIdRef.current !== requestId) return;

          setPrice(nextPrice);

          if (nextPrice.liquidityAvailable === false) {
            setPriceStatus("error");
            setPriceError("No liquidity available for this pair.");
            return;
          }

          if (hasZeroXBalanceIssue(nextPrice)) {
            setPriceStatus("error");
            setPriceError("Insufficient balance for this swap.");
            return;
          }

          setPriceStatus("ready");
        })
        .catch((error) => {
          if (priceRequestIdRef.current !== requestId) return;

          setPriceStatus("error");
          setPriceError(normalizeSwapError(error, "quote"));
        });
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    fromToken,
    selectedAccount,
    selectedChainId,
    sellAmountBaseUnits,
    toToken,
  ]);

  const isReviewDisabled = useMemo(() => {
    const numericAmount = Number(amount);

    return (
      !selectedAccount ||
      !fromToken ||
      !toToken ||
      fromToken.id === toToken.id ||
      !amount ||
      Number.isNaN(numericAmount) ||
      numericAmount <= 0 ||
      priceStatus !== "ready" ||
      !price
    );
  }, [amount, fromToken, price, priceStatus, selectedAccount, toToken]);

  const estimatedReceive = useMemo(() => {
    if (!toToken) return "Select token";
    if (priceStatus === "loading") return "Fetching quote...";
    if (priceStatus === "error") return "Quote unavailable";

    const value = formatEstimatedReceive(price, toToken);

    if (value === "—") return "—";

    return value;
  }, [price, priceStatus, toToken]);

  const quoteNotice = useMemo(() => {
    if (priceStatus === "idle") {
      return "Enter an amount to fetch a live 0x quote.";
    }

    if (priceStatus === "loading") {
      return "Fetching the best available route from 0x...";
    }

    if (priceStatus === "error") {
      return priceError ?? "Could not fetch quote.";
    }

    if (hasZeroXAllowanceIssue(price)) {
      return "Quote ready. Approval will be required in the next step.";
    }

    return "Quote ready. Review screen comes next.";
  }, [price, priceError, priceStatus]);

  const isApprovalApproved = approvalStatus === "approved";

  const needsApproval =
    Boolean(quote) &&
    hasZeroXAllowanceIssue(quote) &&
    approvalStatus !== "approved";

  function handleAmountChange(value: string) {
    setAmount(sanitizeAmountInput(value));
    setQuote(null);
    setQuoteError(null);
    setReviewStatus("idle");
    setSubmitStatus("idle");
    setSubmitError(null);
    setSubmittedTxHash(null);
    setSubmittedExplorerUrl(null);
        setSubmittedSwapStatus("pending");
    setSubmittedSwapError(null);
setApprovalStatus("idle");
    setApprovalError(null);
    setApprovalTxHash(null);
  }

  function handleSwitchTokens() {
    if (!fromToken || !toToken) return;

    setFromToken(toToken);
    setToToken(fromToken);
    setAmount("");
    setPrice(null);
    setPriceError(null);
    setPriceStatus("idle");
    setSubmitStatus("idle");
    setSubmitError(null);
    setSubmittedTxHash(null);
    setSubmittedExplorerUrl(null);
    setApprovalStatus("idle");
    setApprovalError(null);
    setApprovalTxHash(null);
  }

  function handleMaxClick() {
    if (!fromToken) return;

    setAmount(fromToken.balance);
  }

  function handleSelectToken(token: SwapToken) {
    if (tokenPickerSide === "from") {
      if (toToken && token.id === toToken.id) {
        setToToken(fromToken);
      }

      setFromToken(token);
      setAmount("");
    }

    if (tokenPickerSide === "to") {
      if (fromToken && token.id === fromToken.id) {
        setFromToken(toToken);
      }

      setToToken(token);
    }

    setPrice(null);
    setPriceError(null);
    setPriceStatus("idle");
    setSubmitStatus("idle");
    setSubmitError(null);
    setSubmittedTxHash(null);
    setSubmittedExplorerUrl(null);
    setApprovalStatus("idle");
    setApprovalError(null);
    setApprovalTxHash(null);
    setTokenPickerSide(null);
  }

  async function handleOpenReview() {
    if (
      !selectedAccount ||
      !fromToken ||
      !toToken ||
      !sellAmountBaseUnits ||
      sellAmountBaseUnits === "0"
    ) {
      return;
    }

    setIsReviewOpen(true);
    setReviewStatus("loading");
    setQuote(null);
    setQuoteError(null);

    try {
      const nextQuote = await getSwapQuoteWithFallback({
        chainId: selectedChainId,
        sellToken: fromToken.address,
        buyToken: toToken.address,
        sellAmount: sellAmountBaseUnits,
        taker: selectedAccount.address,
        slippageBps,
        swapFeeRecipient: SIMPLE_SWAP_FEE_RECIPIENT || undefined,
        swapFeeBps: simpleSwapFeeBps,
        swapFeeToken: fromToken.address,
      });

      setQuote(nextQuote);
      setReviewStatus("ready");
    } catch (error) {
      setQuoteError(normalizeSwapError(error, "quote"));
      setReviewStatus("error");
    }
  }

  async function handleApproveToken() {
    if (!quote || !fromToken || !toToken || !sellAmountBaseUnits) {
      return;
    }

    const spender = getZeroXAllowanceSpender(quote);

    if (!spender) {
      setApprovalStatus("error");
      setApprovalError("Approval spender is missing in 0x quote.");
      return;
    }

    if (fromToken.type === "native") {
      setApprovalStatus("approved");
      return;
    }

    if (!fromToken.address) {
      setApprovalStatus("error");
      setApprovalError("Token contract address is missing.");
      return;
    }

    setApprovalStatus("approving");
    setApprovalError(null);
    setApprovalTxHash(null);

    try {
      const approvalData = encodeErc20ApproveData(spender, sellAmountBaseUnits);

      const approvalResult = await walletService.sendSelectedPreparedTransaction({
        transaction: {
          to: fromToken.address,
          data: approvalData,
          value: "0",
        },
        waitForReceipt: true,
      });

      setApprovalTxHash(approvalResult.hash);

      const refreshedQuote = await getSwapQuoteWithFallback({
        chainId: selectedChainId,
        sellToken: fromToken.address,
        buyToken: toToken.address,
        sellAmount: sellAmountBaseUnits,
        taker: selectedAccount?.address ?? "",
        slippageBps,
        swapFeeRecipient: SIMPLE_SWAP_FEE_RECIPIENT || undefined,
        swapFeeBps: simpleSwapFeeBps,
        swapFeeToken: fromToken.address,
      });

      setQuote(refreshedQuote);

      if (hasZeroXAllowanceIssue(refreshedQuote)) {
        setApprovalStatus("error");
        setApprovalError(
          "Approval was submitted, but allowance is still not available. Try reviewing the swap again.",
        );
        return;
      }

      setApprovalStatus("approved");
    } catch (error) {
      setApprovalStatus("error");
      setApprovalError(normalizeSwapError(error, "approval"));
    }
  }


  useEffect(() => {
    if (submitStatus !== "submitted" || !submittedTxHash) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;

    async function watchSubmittedSwapReceipt() {
      if (!submittedTxHash) {
        return;
      }

      attempts += 1;

      try {
        const receipt = await getSwapTransactionReceipt(
          selectedChainId,
          submittedTxHash,
        );

        if (cancelled) {
          return;
        }

        console.info("[SIMPL swap] receipt check", {
          attempts,
          chainId: selectedChainId,
          hash: submittedTxHash,
          receipt,
        });

        if (!receipt) {
          timeoutId = window.setTimeout(watchSubmittedSwapReceipt, 4_000);
          return;
        }

        const receiptStatus = (receipt as { status?: unknown }).status;
        const normalizedStatus = String(receiptStatus).toLowerCase();

        const isConfirmed =
          receiptStatus === 1 ||
          receiptStatus === true ||
          normalizedStatus === "1" ||
          normalizedStatus === "0x1" ||
          normalizedStatus === "success" ||
          normalizedStatus === "confirmed";

        const isFailed =
          receiptStatus === 0 ||
          receiptStatus === false ||
          normalizedStatus === "0" ||
          normalizedStatus === "0x0" ||
          normalizedStatus === "failed" ||
          normalizedStatus === "reverted";

        if (isConfirmed) {
          setSubmittedSwapStatus("confirmed");
          setSubmittedSwapError(null);
          return;
        }

        if (isFailed) {
          setSubmittedSwapStatus("failed");
          setSubmittedSwapError("Transaction failed on-chain.");
          return;
        }

        timeoutId = window.setTimeout(watchSubmittedSwapReceipt, 4_000);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[SIMPL swap] receipt check failed", error);

        setSubmittedSwapError(normalizeSwapError(error, "receipt"));

        timeoutId = window.setTimeout(watchSubmittedSwapReceipt, 6_000);
      }
    }

    setSubmittedSwapStatus("pending");
    setSubmittedSwapError(null);

    void watchSubmittedSwapReceipt();

    return () => {
      cancelled = true;

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [submitStatus, submittedTxHash, selectedChainId]);

  async function handleConfirmSwap() {
    if (!quote) return;

    if (hasZeroXAllowanceIssue(quote) && approvalStatus !== "approved") {
      setSubmitStatus("error");
      setSubmitError("Token approval is required. Approve the token first.");
      return;
    }

    setSubmitStatus("submitting");
    setSubmitError(null);
    setSubmittedTxHash(null);
    setSubmittedExplorerUrl(null);

    try {
      const result = await walletService.sendSelectedPreparedTransaction({
        transaction: quote.transaction,
      });

      setSubmittedTxHash(result.hash);
      setSubmittedExplorerUrl(result.explorerUrl);

            setSubmittedSwapStatus("pending");
      setSubmittedSwapError(null);
if (selectedAccount && fromToken && toToken) {
        transactionHistoryService.addTransaction({
          hash: result.hash,
          chainId: selectedChainId,
          chainName: getNetworkLabel(selectedChainId),
          direction: "swap",
          status: "submitted",
          assetType: "swap",
          assetSymbol: `${fromToken.symbol} → ${toToken.symbol}`,
          assetName: `${fromToken.name} to ${toToken.name}`,
          contractAddress: null,
          amount: `${amount} → ${formatEstimatedReceive(quote, toToken)}`,
          fromAddress: selectedAccount.address,
          toAddress: quote.transaction.to,
          explorerUrl: result.explorerUrl,
          createdAt: new Date().toISOString(),
          swapFromSymbol: fromToken.symbol,
          swapFromAmount: amount,
          swapToSymbol: toToken.symbol,
          swapToAmount: formatEstimatedReceive(quote, toToken),
          swapRoute: getZeroXRouteLabel(quote),
          swapSimpleFee: formatSimpleFeeAmount(quote, fromToken, toToken),
          swapNetworkFee: formatNetworkFee(quote),
          swapSlippage: formatSlippageBps(slippageBps),
          swapMinimumReceived: formatMinReceived(quote, toToken),
        });
      }

      setSubmitStatus("submitted");

      setIsReviewOpen(false);
    } catch (error) {
      setSubmitStatus("error");
      setSubmitError(normalizeSwapError(error, "submit"));
    }
  }

  function handleCloseReview() {
    setIsReviewOpen(false);
  }

  function handleDoneAfterSubmittedSwap() {
    setSubmitStatus("idle");
    setIsReviewOpen(false);
  }

  function handleStartNewSwapAfterSubmit() {
    handleNewSwap();
  }

  function handlePresetSlippage(nextSlippageBps: number) {
    const normalizedSlippageBps = clampSlippageBps(nextSlippageBps);

    setSlippageBps(normalizedSlippageBps);
    setCustomSlippagePercent(String(normalizedSlippageBps / 100));
  }

  function handleApplyCustomSlippage() {
    const nextSlippageBps = parseSlippagePercentInput(customSlippagePercent);

    if (nextSlippageBps === null) {
      return;
    }

    const normalizedSlippageBps = clampSlippageBps(nextSlippageBps);

    setSlippageBps(normalizedSlippageBps);
    setCustomSlippagePercent(String(normalizedSlippageBps / 100));
  }

  function handleNewSwap() {
    setAmount("");
    setPrice(null);
    setPriceError(null);
    setPriceStatus("idle");
    setQuote(null);
    setQuoteError(null);
    setReviewStatus("idle");
    setSubmitStatus("idle");
    setSubmitError(null);
    setSubmittedTxHash(null);
    setSubmittedExplorerUrl(null);
    setApprovalStatus("idle");
    setApprovalError(null);
    setApprovalTxHash(null);
    setIsReviewOpen(false);
  }

  const pickerTitle =
    tokenPickerSide === "from" ? "Select token to sell" : "Select token to buy";

  return (
    <div className="ext-popup" data-screen-label="Swap">
      <div className="swap-page">
        <header className="swap-header">
          <button className="swap-icon-button" type="button" onClick={onBack}>
            ←
          </button>

          <div className="swap-header-title">
            <h1>Swap</h1>
            <p>{getNetworkLabel(selectedChainId)}</p>
          </div>

          <button
            className="swap-icon-button"
            type="button"
            aria-label="Swap settings"
            onClick={() => {
              setCustomSlippagePercent(String(slippageBps / 100));
              setIsSwapSettingsOpen(true);
            }}
          >
            ⚙
          </button>
        </header>

        {tokenError ? (
          <section className="swap-error">
            Could not load tokens. {tokenError}
          </section>
        ) : null}

        <section className="swap-card swap-token-card">
          <div className="swap-card-top">
            <span className="swap-label">From</span>

            <button
              className="swap-token-button"
              type="button"
              onClick={() => setTokenPickerSide("from")}
              disabled={isLoadingTokens || tokens.length === 0}
            >
              <span className="swap-token-icon">
                {fromToken?.iconText ?? "?"}
              </span>
              <span>{fromToken?.symbol ?? "Select"}</span>
              <span className="swap-token-chevron">⌄</span>
            </button>
          </div>

          <div className="swap-amount-row">
            <input
              className="swap-amount-input"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => handleAmountChange(event.target.value)}
            />

            <button
              className="swap-max-button"
              type="button"
              onClick={handleMaxClick}
              disabled={!fromToken}
            >
              MAX
            </button>
          </div>

          <div className="swap-balance-row">
            <span>{fromToken?.name ?? "No token selected"}</span>
            <span>
              Balance:{" "}
              {fromToken
                ? `${hideBalances ? "••••" : formatTokenBalance(fromToken.balance)} ${fromToken.symbol}`
                : "—"}
            </span>
          </div>
        </section>

        <div className="swap-switch-wrapper">
          <button
            className="swap-switch-button"
            type="button"
            onClick={handleSwitchTokens}
            disabled={!fromToken || !toToken}
          >
            ↓↑
          </button>
        </div>

        <section className="swap-card swap-token-card">
          <div className="swap-card-top">
            <span className="swap-label">To</span>

            <button
              className="swap-token-button"
              type="button"
              onClick={() => setTokenPickerSide("to")}
              disabled={isLoadingTokens || tokens.length === 0}
            >
              <span className="swap-token-icon">{toToken?.iconText ?? "?"}</span>
              <span>{toToken?.symbol ?? "Select"}</span>
              <span className="swap-token-chevron">⌄</span>
            </button>
          </div>

          <div className="swap-amount-row">
            <div className="swap-estimated-amount">{estimatedReceive}</div>
          </div>

          <div className="swap-balance-row">
            <span>{toToken?.name ?? "No token selected"}</span>
            <span>
              Balance:{" "}
              {toToken
                ? `${hideBalances ? "••••" : formatTokenBalance(toToken.balance)} ${toToken.symbol}`
                : "—"}
            </span>
          </div>
        </section>

        <section className="swap-card swap-details-card">
          <div className="swap-details-row">
            <span>Rate</span>
            <strong>{formatRate(price, fromToken, toToken)}</strong>
          </div>

          <div className="swap-details-row">
            <span>Network fee</span>
            <strong>{formatNetworkFee(price)}</strong>
          </div>

          <div className="swap-details-row">
            <span>Route</span>
            <strong>{priceStatus === "ready" ? getZeroXRouteLabel(price) : "—"}</strong>
          </div>

          <div className="swap-details-row">
            <span>Simple fee</span>
            <strong>
              {priceStatus === "ready"
                ? formatSimpleFeeAmount(price, fromToken, toToken)
                : simpleSwapFeeBps > 0
                  ? `${formatBps(simpleSwapFeeBps)}%`
                  : "—"}
            </strong>
          </div>

          <div className="swap-details-row">
            <span>Minimum received</span>
            <strong>{formatMinReceived(price, toToken)}</strong>
          </div>
        </section>

        <section
          className={
            priceStatus === "error" ? "swap-error" : "swap-notice"
          }
        >
          {quoteNotice}
        </section>

        <footer className="swap-footer">
          <button
            className="swap-review-button"
            type="button"
            disabled={isReviewDisabled}
            onClick={handleOpenReview}
          >
            Review swap
          </button>
        </footer>
      </div>

      {submitStatus === "submitted" ? (
        <div className="swap-token-modal-backdrop">
          <div
            className="swap-token-modal swap-submitted-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="swap-token-modal-header">
              <div>
                <h2>{getSubmittedSwapStatusTitle(submittedSwapStatus)}</h2>
                <p>{getSubmittedSwapStatusSubtitle(submittedSwapStatus)}</p>
              </div>

              <button
                className="swap-icon-button"
                type="button"
                onClick={handleDoneAfterSubmittedSwap}
                aria-label="Close submitted swap screen"
              >
                ×
              </button>
            </div>

            <div
              className={`swap-submitted-status-card swap-submitted-status-card--${submittedSwapStatus}`}
            >
              <div className="swap-submitted-status-icon">
                {getSubmittedSwapStatusIcon(submittedSwapStatus)}
              </div>
              <div>
                <strong>{getSubmittedSwapStatusCardTitle(submittedSwapStatus)}</strong>
                <p>{getSubmittedSwapStatusCardText(submittedSwapStatus)}</p>
              </div>
            </div>

            {submittedSwapError ? (
              <p className="swap-submitted-error">{submittedSwapError}</p>
            ) : null}

            <div className="swap-review-details">
              <div className="swap-review-row">
                <span>You paid</span>
                <strong>
                  {amount} {fromToken?.symbol ?? ""}
                </strong>
              </div>

              <div className="swap-review-row">
                <span>You receive</span>
                <strong>
                  {quote && toToken
                    ? `${formatEstimatedReceive(quote, toToken)} ${toToken.symbol}`
                    : "—"}
                </strong>
              </div>

              <div className="swap-review-row">
                <span>Status</span>
                <strong
                  className={`swap-submitted-status-badge swap-submitted-status-badge--${submittedSwapStatus}`}
                >
                  {getSubmittedSwapStatusLabel(submittedSwapStatus)}
                </strong>
              </div>

              <div className="swap-review-row">
                <span>Simple fee</span>
                <strong>
                  {quote ? formatSimpleFeeAmount(quote, fromToken, toToken) : "—"}
                </strong>
              </div>

              <div className="swap-review-row">
                <span>Network fee</span>
                <strong>{quote ? formatNetworkFee(quote) : "—"}</strong>
              </div>

              <div className="swap-review-row">
                <span>Tx hash</span>
                <strong className="swap-submitted-hash">
                  {formatShortTransactionHash(submittedTxHash)}
                </strong>
              </div>
            </div>

            <div className="swap-submitted-actions">
              {submittedExplorerUrl ? (
                <a
                  className="swap-secondary-action"
                  href={submittedExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on explorer
                </a>
              ) : null}

              <button
                className="swap-secondary-action"
                type="button"
                onClick={handleStartNewSwapAfterSubmit}
              >
                New swap
              </button>

              <button
                className="swap-review-button"
                type="button"
                onClick={handleDoneAfterSubmittedSwap}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSwapSettingsOpen ? (
        <div className="swap-token-modal-backdrop">
          <div className="swap-token-modal" role="dialog" aria-modal="true">
            <div className="swap-token-modal-header">
              <div>
                <h2>Swap settings</h2>
                <p>Control price protection for 0x quotes</p>
              </div>

              <button
                className="swap-icon-button"
                type="button"
                onClick={() => setIsSwapSettingsOpen(false)}
              >
                ×
              </button>
            </div>

            <section className="swap-settings-section">
              <div className="swap-settings-label">
                <strong>Max slippage</strong>
                <span>Current: {formatSlippageBps(slippageBps)}</span>
              </div>

              <div className="swap-slippage-grid">
                <button
                  type="button"
                  className={slippageBps === 10 ? "active" : ""}
                  onClick={() => handlePresetSlippage(10)}
                >
                  0.1%
                </button>

                <button
                  type="button"
                  className={slippageBps === 50 ? "active" : ""}
                  onClick={() => handlePresetSlippage(50)}
                >
                  0.5%
                </button>

                <button
                  type="button"
                  className={slippageBps === 100 ? "active" : ""}
                  onClick={() => handlePresetSlippage(100)}
                >
                  1.0%
                </button>
              </div>

              <div className="swap-custom-slippage">
                <input
                  inputMode="decimal"
                  placeholder="Custom %"
                  value={customSlippagePercent}
                  onChange={(event) =>
                    setCustomSlippagePercent(event.target.value)
                  }
                />

                <button type="button" onClick={handleApplyCustomSlippage}>
                  Apply
                </button>
              </div>

              {slippageBps >= 300 ? (
                <section className="swap-warning">
                  High slippage increases the chance of receiving less than
                  expected.
                </section>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}

      {isReviewOpen ? (
        <div className="swap-token-modal-backdrop">
          <div className="swap-token-modal" role="dialog" aria-modal="true">
            <div className="swap-token-modal-header">
              <div>
                <h2>Review swap</h2>
                <p>Slippage {formatSlippageBps(slippageBps)}</p>
              </div>

              <button
                className="swap-icon-button"
                type="button"
                onClick={handleCloseReview}
              >
                ×
              </button>
            </div>

            {reviewStatus === "loading" ? (
              <div className="swap-empty-state">Fetching final quote...</div>
            ) : null}

            {reviewStatus === "error" ? (
              <section className="swap-error">
                {quoteError ?? "Could not fetch final quote."}
              </section>
            ) : null}

            {reviewStatus === "ready" && quote && fromToken && toToken ? (
              <div className="swap-review-content">
                <div className="swap-review-main">
                  <div>
                    <span>You pay</span>
                    <strong>
                      {amount} {fromToken.symbol}
                    </strong>
                  </div>

                  <div>
                    <span>You receive</span>
                    <strong>
                      {formatEstimatedReceive(quote, toToken)} {toToken.symbol}
                    </strong>
                  </div>
                </div>

                <div className="swap-review-details">
                  <div className="swap-details-row">
                    <span>Rate</span>
                    <strong>{formatRate(quote, fromToken, toToken)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>Minimum received</span>
                    <strong>{formatMinReceived(quote, toToken)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>Network fee</span>
                    <strong>{formatNetworkFee(quote)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>Route</span>
                    <strong>{getZeroXRouteLabel(quote)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>Simple fee</span>
                    <strong>{formatSimpleFeeAmount(quote, fromToken, toToken)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>Approval</span>
                    <strong>
                      {needsApproval ? "Required" : "Not needed"}
                    </strong>
                  </div>
                </div>

                {isApprovalApproved && approvalTxHash ? (
                  <section className="swap-success">
                    <strong>Approval confirmed</strong>
                    <span>{approvalTxHash}</span>
                  </section>
                ) : null}

                {approvalStatus === "error" && approvalError ? (
                  <section className="swap-error">{approvalError}</section>
                ) : null}

                {submitStatus === "submitted" && submittedTxHash ? (
                  <section className="swap-success">
                    <strong>Swap submitted</strong>
                    <span>{submittedTxHash}</span>

                    <div className="swap-success-actions">
                      {submittedExplorerUrl ? (
                        <a
                          href={submittedExplorerUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction
                        </a>
                      ) : null}

                      <button type="button" onClick={onBack}>
                        Back to wallet
                      </button>

                      <button type="button" onClick={handleNewSwap}>
                        New swap
                      </button>
                    </div>
                  </section>
                ) : null}

                {submitStatus === "error" && submitError ? (
                  <section className="swap-error">{submitError}</section>
                ) : null}

                {needsApproval ? (
                  <button
                    className="swap-review-button"
                    type="button"
                    onClick={() => void handleApproveToken()}
                    disabled={
                      approvalStatus === "approving" ||
                      isApprovalApproved
                    }
                  >
                    {approvalStatus === "approving"
                      ? `Approving ${fromToken.symbol}…`
                      : `Approve ${fromToken.symbol}`}
                  </button>
                ) : (
                  <button
                    className="swap-review-button"
                    type="button"
                    onClick={() => void handleConfirmSwap()}
                    disabled={
                      submitStatus === "submitting" ||
                      submitStatus === "submitted"
                    }
                  >
                    {submitStatus === "submitting"
                      ? "Submitting swap…"
                      : submitStatus === "submitted"
                        ? "Swap submitted"
                        : "Confirm swap"}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tokenPickerSide ? (
        <div className="swap-token-modal-backdrop">
          <div className="swap-token-modal" role="dialog" aria-modal="true">
            <div className="swap-token-modal-header">
              <div>
                <h2>{pickerTitle}</h2>
                <p>{getNetworkLabel(selectedChainId)}</p>
              </div>

              <button
                className="swap-icon-button"
                type="button"
                onClick={() => setTokenPickerSide(null)}
              >
                ×
              </button>
            </div>

            <div className="swap-token-list">
              {tokens.map((token) => (
                <button
                  key={token.id}
                  className="swap-token-list-item"
                  type="button"
                  onClick={() => handleSelectToken(token)}
                >
                  <span className="swap-token-icon">{token.iconText}</span>

                  <span className="swap-token-list-body">
                    <strong>{token.symbol}</strong>
                    <span>{token.name}</span>
                  </span>

                  <span className="swap-token-list-balance">
                    {hideBalances ? "••••" : formatTokenBalance(token.balance)}
                  </span>
                </button>
              ))}

              {tokens.length === 0 && !isLoadingTokens ? (
                <div className="swap-empty-state">
                  No visible assets found. Add a custom token first.
                </div>
              ) : null}

              {isLoadingTokens ? (
                <div className="swap-empty-state">Loading tokens...</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SwapPage;
