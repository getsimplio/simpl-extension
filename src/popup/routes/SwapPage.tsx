// src/popup/routes/SwapPage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { shortenAddress } from "@getsimpl/core";
import type { WalletAccount } from "../../core/accounts/account.types";
import { isWatchOnly } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import {
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
import { useTranslation, t } from "../../i18n";
import {
  tokenRegistryService,
  getRegisteredTokensByChainId,
  type TokenPreview,
  type CustomToken,
  type RegisteredToken,
} from "../../core/tokens/token-registry";
import { hiddenAssetService } from "../../core/tokens/hidden-asset.service";
import {
  getNetworkDisplayName,
  isSolanaChainId,
  isTronChainId,
} from "../../core/networks/chain-registry";
import { AssetIcon } from "../components/AssetIcon";
import { SelectNetworkPage } from "../components/SelectNetworkPage";
import { TokenWithChainBadge } from "../components/TokenWithChainBadge";
import { SwapHeader } from "../components/SwapHeader";
import {
  CrossChainTokenPicker,
  type PickerToken,
} from "../components/CrossChainTokenPicker";
import { SolanaSwapPage } from "./SolanaSwapPage";
import { BridgePage } from "./BridgePage";
import { LIFI_NATIVE_ADDRESS } from "../../core/bridge/lifi-bridge.service";
import "./SwapPage.css";

type SwapPageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onBack: () => void;
  // Explicit navigation to the wallet Home screen for the post-swap/bridge
  // "Back to wallet" CTA — must land on Home, not the previous in-flow screen.
  // Falls back to onBack when not provided.
  onNavigateHome?: () => void;
  onSwapCompleted?: () => void | Promise<void>;
  // Re-sync global view state after switching network so the selectedChainId
  // prop updates and the token list / quote reload for the new chain.
  onChanged?: () => void | Promise<void>;
  // When opened from an asset details modal, this asset is preselected as the
  // receive/TO token. The selected network is expected to already match the
  // asset's chain (the caller aligns it before navigating).
  initialToAsset?: WalletAssetBalance | null;
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
type AmountMode = "sell" | "buy";
type PriceStatus = "idle" | "loading" | "ready" | "error";
type ReviewStatus = "idle" | "loading" | "ready" | "error";
type SubmitStatus = "idle" | "submitting" | "submitted" | "error";
type ApprovalStatus = "idle" | "approving" | "approved" | "error";
type ImportStatus = "idle" | "fetching" | "ready" | "error";


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



function toRpcQuantity(value?: string): string {
  if (!value || value === "0") {
    return "0x0";
  }

  if (value.startsWith("0x")) {
    return value;
  }

  return `0x${BigInt(value).toString(16)}`;
}

function decodeEvmErrorString(data: unknown): string | null {
  if (typeof data !== "string") {
    return null;
  }

  const hex = data.startsWith("0x") ? data.slice(2) : data;

  // Error(string) selector: 0x08c379a0
  if (!hex.startsWith("08c379a0") || hex.length < 8 + 64 + 64) {
    return null;
  }

  const lengthHex = hex.slice(8 + 64, 8 + 128);
  const length = Number.parseInt(lengthHex, 16);

  if (!Number.isFinite(length) || length <= 0) {
    return null;
  }

  const stringHex = hex.slice(8 + 128, 8 + 128 + length * 2);
  const bytes: number[] = [];

  for (let i = 0; i < stringHex.length; i += 2) {
    bytes.push(Number.parseInt(stringHex.slice(i, i + 2), 16));
  }

  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

function getRpcErrorReason(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Transaction simulation failed.";
  }

  const record = error as {
    message?: unknown;
    data?: unknown;
  };

  const decoded = decodeEvmErrorString(record.data);

  if (decoded) {
    return decoded;
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  return "Transaction simulation failed.";
}

async function simulateSwapTransaction(input: {
  chainId: number;
  from: string;
  transaction: {
    to: string;
    data: string;
    value?: string;
    gas?: string;
  };
}): Promise<void> {
  const rpcUrl = SWAP_RECEIPT_RPC_URLS[input.chainId];

  if (!rpcUrl) {
    throw new Error(`Simulation RPC is not configured for chain ${input.chainId}.`);
  }

  const callParams: Record<string, string> = {
    from: input.from,
    to: input.transaction.to,
    data: input.transaction.data,
    value: toRpcQuantity(input.transaction.value),
  };

  if (input.transaction.gas) {
    callParams.gas = toRpcQuantity(input.transaction.gas);
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "eth_call",
      params: [callParams, "latest"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Swap simulation RPC failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: string;
    error?: unknown;
  };

  if (payload.error) {
    const reason = getRpcErrorReason(payload.error);

    throw new Error(
      `This swap is likely to fail before broadcast. Reason: ${reason}. Try a smaller amount, higher slippage, or avoid this restricted token.`,
    );
  }
}


type SubmittedSwapStatus = "pending" | "confirmed" | "failed";

const SLIPPAGE_STORAGE_KEY = "simple:swapSlippageBps";
const DEFAULT_SLIPPAGE_BPS = 50;
const QUOTE_REFRESH_INTERVAL_S = 15;
const MIN_SLIPPAGE_BPS = 1;
const MAX_SLIPPAGE_BPS = 1000;

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
  // Set (non-zero) for buy/exact-out mode — "receive this much". The PancakeV2
  // fallback is exact-in only, so buy-mode requests never fall back to it.
  buyAmount?: string;
  taker: string;
};

type SwapQuoteRequest = SwapPriceRequest & {
  slippageBps?: number;
  // No swapFee* fields: fees are backend-authoritative (injected server-side by
  // getsimpl-api). The extension never sends a fee bps / recipient / token.
};

async function getSwapPriceWithFallback(
  params: SwapPriceRequest,
): Promise<ZeroXSwapPrice> {
  try {
    return await getZeroXSwapPrice(params);
  } catch (zeroXError) {
    // Buy/exact-out mode has no PancakeV2 equivalent (getAmountsOut is
    // exact-in only), so surface the 0x error directly.
    if (
      !isPancakeV2SupportedChain(params.chainId) ||
      (params.buyAmount && params.buyAmount !== "0")
    ) {
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
    if (
      !isPancakeV2SupportedChain(params.chainId) ||
      (params.buyAmount && params.buyAmount !== "0")
    ) {
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

// Canonical network name from the chain registry (single source of truth).
const getNetworkLabel = getNetworkDisplayName;

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

// Formats a raw integer token amount for swap display.
// Never rounds a positive value to "0" — shows "<0.00000001" for sub-precision amounts.
// Shows at most 8 decimal places; always 2 significant digits past any leading zeros.
function formatSwapAmount(value: string | bigint | undefined, decimals: number): string {
  if (value === undefined || value === null || value === "") return "—";

  let raw: bigint;
  try {
    raw = typeof value === "bigint" ? value : BigInt(value as string);
  } catch {
    return "—";
  }

  if (raw === 0n) return "0";

  const absRaw = raw < 0n ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = absRaw / base;
  const fraction = absRaw % base;

  if (fraction === 0n) {
    return whole.toLocaleString("en-US");
  }

  const fractionFull = fraction.toString().padStart(decimals, "0");
  const firstNonZeroIdx = fractionFull.search(/[1-9]/);
  const maxDisplay = Math.min(8, decimals);

  // Value is below the smallest unit we display → show minimum threshold
  if (firstNonZeroIdx < 0 || firstNonZeroIdx >= maxDisplay) {
    return `<0.${"0".repeat(maxDisplay - 1)}1`;
  }

  // Show at least 6 decimal places OR enough to expose 2 significant digits
  const displayPlaces = Math.min(
    Math.max(firstNonZeroIdx + 2, Math.min(6, decimals)),
    maxDisplay,
  );

  const displayFraction = fractionFull.slice(0, displayPlaces).replace(/0+$/, "");

  if (!displayFraction) {
    return `<0.${"0".repeat(maxDisplay - 1)}1`;
  }

  return `${whole === 0n ? "0" : whole.toLocaleString("en-US")}.${displayFraction}`;
}


function formatEstimatedReceive(
  price: ZeroXSwapPrice | null,
  toToken: SwapToken | null,
): string {
  if (!price || !toToken) return "—";

  return formatSwapAmount(price.buyAmount, toToken.decimals);
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
  const amount = formatSwapAmount(fee.amount, decimals);

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

  const value = formatSwapAmount(price.minBuyAmount, toToken.decimals);

  if (value === "—") return value;

  return `${value} ${toToken.symbol}`;
}

function getNativeSymbol(chainId: number): string {
  return chainId === 56 ? "BNB" : "ETH";
}

// Returns the estimated network fee in native token atomic units (wei / gwei base).
// Prefers totalNetworkFee; falls back to gas × gasPrice if that field is absent.
function getNetworkFeeRaw(price: ZeroXSwapPrice | null): bigint {
  if (!price) return 0n;

  if (price.totalNetworkFee) {
    try {
      const fee = BigInt(price.totalNetworkFee);
      return fee < 0n ? -fee : fee;
    } catch {
      // fall through to gas × gasPrice
    }
  }

  if (price.gas && price.gasPrice) {
    try {
      return BigInt(price.gas) * BigInt(price.gasPrice);
    } catch {
      return 0n;
    }
  }

  return 0n;
}

function formatNetworkFee(price: ZeroXSwapPrice | null, chainId: number): string {
  // getNetworkFeeRaw already returns an absolute value, but strip any stray
  // leading sign defensively so the fee is never shown as negative.
  const fee = getNetworkFeeRaw(price);
  const absFee = fee < 0n ? -fee : fee;
  if (absFee === 0n) return "—";

  const value = formatSwapAmount(absFee.toString(), 18).replace(/^-/, "");
  if (value === "—" || value === "0") return "—";

  return `~${value} ${getNativeSymbol(chainId)}`;
}

// Conservative native-gas reserves (wei) used when a live fee estimate is not
// yet available, so MAX reserves gas without consuming the entire native
// balance. Kept small so typical low balances still yield a positive amount;
// once a quote loads, the live fee (×1.5) is used instead.
const NATIVE_MAX_GAS_RESERVE_WEI: Record<number, bigint> = {
  1: 300_000_000_000_000n, // ~0.0003 ETH
  56: 100_000_000_000_000n, // ~0.0001 BNB
  8453: 50_000_000_000_000n, // ~0.00005 ETH
  11155111: 100_000_000_000_000n, // ~0.0001 ETH
};

const DEFAULT_NATIVE_MAX_GAS_RESERVE_WEI = 200_000_000_000_000n; // ~0.0002

// Exact integer-units → decimal string (no rounding), suitable for an input value.
function formatUnitsToDecimalString(value: bigint, decimals: number): string {
  if (value <= 0n) return "0";

  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return `${whole.toString()}.${fractionStr}`;
}

// Responsive amount typography: shrink the font as the value grows so big
// numbers never overflow or clip the From / To sections. Short values stay
// large and readable; long values step down so they fit one line.
function getAmountFontSize(text: string): number {
  const len = text.trim().length;

  if (len <= 8) return 36; // normal
  if (len <= 12) return 28;
  if (len <= 16) return 24; // long
  return 22; // very long
}

// Tighten tracking for long values so they still fit on one line.
function getAmountLetterSpacing(text: string): string {
  return text.trim().length > 12 ? "-0.035em" : "-0.02em";
}

function formatRate(
  price: ZeroXSwapPrice | null,
  fromToken: SwapToken | null,
  toToken: SwapToken | null,
): string {
  if (!price || !fromToken || !toToken) return "—";

  let sellRaw: bigint;
  let buyRaw: bigint;
  try {
    sellRaw = BigInt(price.sellAmount ?? "0");
    buyRaw = BigInt(price.buyAmount ?? "0");
  } catch {
    return "—";
  }

  if (sellRaw <= 0n || buyRaw <= 0n) return "—";

  // rateRaw = "how many buyToken atoms per 1 full sellToken unit"
  // = buyRaw × 10^sellDecimals / sellRaw
  const rateRaw = (buyRaw * 10n ** BigInt(fromToken.decimals)) / sellRaw;
  const rateFormatted = formatSwapAmount(rateRaw, toToken.decimals);

  if (rateFormatted === "—" || rateFormatted === "0") return "—";

  return `1 ${fromToken.symbol} ≈ ${rateFormatted} ${toToken.symbol}`;
}



function getSubmittedSwapStatusTitle(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return t("swap.swapConfirmed");
  if (status === "failed") return t("swap.swapFailedTitle");
  return t("swap.swapSubmitted");
}

function getSubmittedSwapStatusSubtitle(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return t("swap.confirmedOnChain");
  if (status === "failed") return t("swap.failedOnChain");
  return t("swap.waitingConfirmation");
}

function getSubmittedSwapStatusLabel(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return t("activity.status.confirmed");
  if (status === "failed") return t("activity.status.failed");
  return t("activity.status.pending");
}

function getSubmittedSwapStatusCardTitle(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return t("swap.txConfirmed");
  if (status === "failed") return t("swap.txFailed");
  return t("swap.txSent");
}

function getSubmittedSwapStatusCardText(status: SubmittedSwapStatus): string {
  if (status === "confirmed") return t("swap.swapConfirmedCard");
  if (status === "failed") return t("swap.swapFailedCard");
  return t("swap.swapSubmittedCard");
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
    return t("errors.transactionRejected");
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
    return t("errors.networkUnavailable");
  }

  if (
    message.includes("allowance") ||
    message.includes("approve") ||
    message.includes("approval")
  ) {
    return t("swap.approvalFailed");
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
    return t("swap.swapFailed");
  }

  if (context === "receipt") {
    return "Could not check transaction status. The transaction may still be pending.";
  }

  // Unknown failure — never surface the raw provider/ethers string to the UI.
  return t("errors.generic");
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

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

function registeredToSwapToken(token: RegisteredToken): SwapToken {
  return {
    id: `reg-${token.chainId}-${token.address.toLowerCase()}`,
    symbol: token.symbol,
    name: token.name,
    balance: "0",
    decimals: token.decimals,
    type: "erc20",
    address: token.address,
    iconText: getTokenIconText(token.symbol),
  };
}

function customToSwapToken(token: CustomToken): SwapToken {
  return {
    id: `custom-${token.chainId}-${token.address.toLowerCase()}`,
    symbol: token.symbol,
    name: token.name,
    balance: "0",
    decimals: token.decimals,
    type: "erc20",
    address: token.address,
    iconText: getTokenIconText(token.symbol),
  };
}

// Delegates to @getsimpl/core (single source of truth). Display-only; head 6,
// tail 4, "…" separator — identical output for real addresses.
function truncatePickerAddress(address: string): string {
  return shortenAddress(address, { start: 6, end: 4, separator: "…" });
}

// Returns a known registered token whose hex address shares a common prefix with the input.
// Used to suggest "Did you mean BTCB?" when a user pastes a typo'd address.
function findSimilarRegisteredToken(
  address: string,
  tokens: RegisteredToken[],
): RegisteredToken | null {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  if (normalized.length !== 40) return null;

  // Require the first 5 hex characters to match — enough to catch one-digit typos at char 6+
  const prefix = normalized.slice(0, 5);

  return (
    tokens.find((t) => {
      const tokenHex = t.address.toLowerCase().replace(/^0x/, "");
      return tokenHex.startsWith(prefix) && tokenHex !== normalized;
    }) ?? null
  );
}

export function SwapPage({
  selectedAccount,
  walletState,
  onBack,
  onNavigateHome,
  onSwapCompleted,
  onChanged,
  initialToAsset,
}: SwapPageProps) {
  const { t } = useTranslation();
  const [networkSelectorOpen, setNetworkSelectorOpen] = useState(false);
  // Destination chain for the chain-aware Swap. Equal to the source chain → a
  // same-chain swap (existing 0x / Jupiter flow). Different → a cross-chain swap
  // handled by the LI.FI-backed cross-chain panel.
  const [destChainId, setDestChainId] = useState<number>(
    walletState.selectedChainId,
  );
  // Cross-network "To" token picker + the token picked on another chain (handed
  // to the cross-chain panel so the route matches the user's choice).
  const [crossToPickerOpen, setCrossToPickerOpen] = useState(false);
  const [pendingToToken, setPendingToToken] = useState<PickerToken | null>(null);
  const [tokens, setTokens] = useState<SwapToken[]>([]);
  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);
  // Preselected receive token from an asset details modal. Captured once at
  // mount and applied on the first token load, after which normal
  // preserve/default selection takes over.
  const initialToAssetRef = useRef(initialToAsset ?? null);
  const appliedInitialToAssetRef = useRef(false);
  // FROM sell input (sell mode) and TO target receive input (buy mode).
  const [amount, setAmount] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");
  // "sell" = user drives FROM amount, TO is calculated. "buy" = user drives TO
  // target receive amount, FROM is calculated from the quote.
  const [amountMode, setAmountMode] = useState<AmountMode>("sell");
  const [maxReserveNotice, setMaxReserveNotice] = useState<string | null>(null);
  // Custom "spend X% of FROM balance" control in the FROM section.
  // selectedPercent is the applied custom value (null = none). The pencil chip
  // toggles inline editing.
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customPercentValue, setCustomPercentValue] = useState("");
  const [customPercentInvalid, setCustomPercentInvalid] = useState(false);
  const hideBalances = readHideBalancesSetting();
  const [tokenPickerSide, setTokenPickerSide] =
    useState<TokenPickerSide | null>(null);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Token picker search + import
  const [tokenPickerSearch, setTokenPickerSearch] = useState("");
  const [importedCustomTokens, setImportedCustomTokens] = useState<CustomToken[]>([]);
  const [tokenImportStatus, setTokenImportStatus] = useState<ImportStatus>("idle");
  const [tokenImportPreview, setTokenImportPreview] = useState<TokenPreview | null>(null);
  const [tokenImportError, setTokenImportError] = useState<string | null>(null);

  // Post-swap toast
  const [swapToastMessage, setSwapToastMessage] = useState<string | null>(null);
  const hasAutoAddedRef = useRef(false);

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
  const [quoteRefreshTick, setQuoteRefreshTick] = useState(0);
  const [quoteCountdown, setQuoteCountdown] = useState<number | null>(null);

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

  // Whenever the source network changes (header selector), default the
  // destination back to the source so we land on a same-chain swap.
  useEffect(() => {
    setDestChainId(selectedChainId);
    setPendingToToken(null);
  }, [selectedChainId]);

  const isCrossChain = destChainId !== selectedChainId;

  // The cross-chain panel collapsed its pair onto a single chain — return to the
  // same-chain swap flow for that chain (0x / Jupiter). Switch the active
  // network when needed so the right same-chain screen renders.
  async function handleCrossChainCollapse(chainId: number) {
    setPendingToToken(null);
    if (chainId !== selectedChainId) {
      await walletService.setSelectedChainId(chainId);
      await onChanged?.();
    }
    setDestChainId(chainId);
  }

  // Selecting a TO token from the cross-network picker. Same chain → the
  // existing 0x same-chain To token; a different chain → switch the destination
  // (and preselect that token) so the route becomes a cross-chain LI.FI swap.
  function handlePickToToken(picked: PickerToken) {
    setCrossToPickerOpen(false);
    if (picked.chainId === selectedChainId) {
      setPendingToToken(null);
      setDestChainId(selectedChainId);
      setToToken({
        id: `cc-${picked.chainId}-${picked.address.toLowerCase()}`,
        symbol: picked.symbol,
        name: picked.name,
        balance: "0",
        decimals: picked.decimals,
        type: picked.isNative ? "native" : "erc20",
        address: picked.isNative ? ZERO_X_NATIVE_TOKEN_ADDRESS : picked.address,
        iconText: getTokenIconText(picked.symbol),
      });
      setAmount("");
      setReceiveAmount("");
      setAmountMode("sell");
      setPrice(null);
      setPriceError(null);
      setPriceStatus("idle");
      resetTransientQuoteState();
      return;
    }
    // Cross-chain: hand off to the LI.FI panel with this chain + token.
    setPendingToToken(picked);
    setDestChainId(picked.chainId);
  }

  // Switch the active network from the shared selector. Clears all quote /
  // approval / amount state (a quote is chain-specific and must not survive a
  // chain change), then re-syncs global state so the selectedChainId prop
  // updates — which reloads the token list and resets FROM/TO for the new
  // chain (native FROM + default stablecoin TO via the token-load effect).
  async function selectNetwork(chainId: number) {
    setNetworkSelectorOpen(false);

    if (chainId === selectedChainId) {
      return;
    }

    // Clear the previous chain's quote / review / approval / amounts.
    setAmount("");
    setReceiveAmount("");
    setAmountMode("sell");
    setPrice(null);
    setPriceStatus("idle");
    setPriceError(null);
    setQuote(null);
    setQuoteError(null);
    setReviewStatus("idle");
    setIsReviewOpen(false);
    setApprovalStatus("idle");
    setApprovalError(null);
    setApprovalTxHash(null);
    setSubmitStatus("idle");
    setSubmitError(null);

    await walletService.setSelectedChainId(chainId);
    // Re-sync global state: the selectedChainId prop updates and the token
    // list / pair reload for the new chain.
    await onChanged?.();
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, String(slippageBps));
    } catch {
      // localStorage is optional.
    }
  }, [slippageBps]);

  // Escape closes the Swap settings modal (matches the keyboard UX used by the
  // other selectors/sheets in the app).
  useEffect(() => {
    if (!isSwapSettingsOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsSwapSettingsOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSwapSettingsOpen]);

  // Seed the token pair from an asset opened via "Swap" in the details modal:
  // the asset becomes the TO token, FROM defaults to the chain's native token.
  // If the asset is itself native, FROM falls back to a stablecoin / other
  // token so FROM and TO are never identical.
  function applyInitialToAssetSelection(
    asset: WalletAssetBalance,
    list: SwapToken[],
  ) {
    const wanted =
      list.find((token) => token.id === asset.id) ?? assetToSwapToken(asset);

    const findStable = (excludeId: string) =>
      list.find((token) => {
        const symbol = token.symbol.toUpperCase();
        return (
          (symbol === "USDC" || symbol === "USDT" || symbol === "DAI") &&
          token.id !== excludeId
        );
      });

    if (wanted.type === "native") {
      // Buying the native token: TO = native, FROM = stablecoin / any non-native.
      const from =
        findStable(wanted.id) ??
        list.find(
          (token) => token.type !== "native" && token.id !== wanted.id,
        ) ??
        null;

      if (from) {
        setToToken(wanted);
        setFromToken(from);
        return;
      }

      // No alternative token on this chain — fall back to native FROM and the
      // best available non-native TO so the pair is never duplicated.
      setFromToken(wanted);
      setToToken(
        list.find((token) => token.type !== "native" && token.id !== wanted.id) ??
          null,
      );
      return;
    }

    // Buying an ERC-20: TO = the asset, FROM = native (or any other token).
    const from =
      list.find((token) => token.type === "native") ??
      list.find((token) => token.id !== wanted.id) ??
      null;

    setToToken(wanted);
    setFromToken(from);
  }

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

        const pendingInitialAsset = appliedInitialToAssetRef.current
          ? null
          : initialToAssetRef.current;
        appliedInitialToAssetRef.current = true;

        if (pendingInitialAsset) {
          applyInitialToAssetSelection(pendingInitialAsset, nextTokens);
        } else {
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
        }
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

  // Target receive amount in base units (buy mode), from the TO token decimals.
  const buyAmountBaseUnits = useMemo(() => {
    if (!toToken) return null;

    return parseDecimalUnits(receiveAmount, toToken.decimals);
  }, [receiveAmount, toToken]);

  // Reset the percent controls when the FROM token or network changes — a new
  // balance makes a previously chosen percentage meaningless.
  useEffect(() => {
    setSelectedPercent(null);
    setIsEditingCustom(false);
    setCustomPercentValue("");
    setCustomPercentInvalid(false);
  }, [fromToken?.id, selectedChainId]);

  // Whether the FROM token has any balance to spend (chips disabled when not).
  const fromBalanceIsZero = useMemo(() => {
    if (!fromToken) return true;
    const numeric = Number(fromToken.balance);
    return !Number.isFinite(numeric) || numeric <= 0;
  }, [fromToken]);

  // Quote amount fields for the current mode (sell vs buy/exact-out), or null
  // when the active input is empty/zero. Sell mode sends sellAmount; buy mode
  // sends buyAmount (sellAmount left empty — 0x computes the required sell).
  function getQuoteAmountFields(): {
    sellAmount: string;
    buyAmount?: string;
  } | null {
    if (amountMode === "buy") {
      if (!buyAmountBaseUnits || buyAmountBaseUnits === "0") return null;
      return { sellAmount: "", buyAmount: buyAmountBaseUnits };
    }

    if (!sellAmountBaseUnits || sellAmountBaseUnits === "0") return null;
    return { sellAmount: sellAmountBaseUnits };
  }

  // Registered tokens for current chain (for picker "Popular" section)
  const registeredTokensForChain = useMemo(() => {
    return getRegisteredTokensByChainId(selectedChainId);
  }, [selectedChainId]);

  // Computed picker sections (wallet, popular, imported) filtered by search
  const { pickerWallet, pickerPopular, pickerImported } = useMemo(() => {
    const searchLower = tokenPickerSearch.toLowerCase().trim();
    const walletAddresses = new Set(tokens.map((t) => t.address.toLowerCase()));

    function matchesSearch(name: string, symbol: string, address: string): boolean {
      if (!searchLower) return true;
      return (
        symbol.toLowerCase().includes(searchLower) ||
        name.toLowerCase().includes(searchLower) ||
        address.toLowerCase().includes(searchLower)
      );
    }

    return {
      pickerWallet: tokens.filter((t) => matchesSearch(t.name, t.symbol, t.address)),
      pickerPopular: registeredTokensForChain
        .filter(
          (r) =>
            !walletAddresses.has(r.address.toLowerCase()) &&
            matchesSearch(r.name, r.symbol, r.address),
        )
        .map(registeredToSwapToken),
      pickerImported: importedCustomTokens
        .filter(
          (c) =>
            !walletAddresses.has(c.address.toLowerCase()) &&
            matchesSearch(c.name, c.symbol, c.address),
        )
        .map(customToSwapToken),
    };
  }, [tokenPickerSearch, tokens, registeredTokensForChain, importedCustomTokens]);

  const pickerHasNoResults =
    pickerWallet.length === 0 && pickerPopular.length === 0 && pickerImported.length === 0;

  useEffect(() => {
    priceRequestIdRef.current += 1;

    const requestId = priceRequestIdRef.current;

    setPrice(null);
    setPriceError(null);

    const amountFields = getQuoteAmountFields();

    // 0x only prices EVM SAME-CHAIN swaps. Cross-chain pairs are owned by the
    // bridge (LI.FI), and non-EVM chains (TRON 728126428 / Solana) have no 0x
    // endpoint — calling /swap/allowance-holder/price for them 400s. Never issue
    // a 0x price request in those cases; the bridge/Jupiter flows handle pricing.
    if (
      isCrossChain ||
      isTronChainId(selectedChainId) ||
      isSolanaChainId(selectedChainId)
    ) {
      setPriceStatus("idle");
      return;
    }

    if (
      !selectedAccount ||
      !fromToken ||
      !toToken ||
      fromToken.address.toLowerCase() === toToken.address.toLowerCase() ||
      !amountFields
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
        ...amountFields,
        taker: selectedAccount.address,
      })
        .then((nextPrice) => {
          if (priceRequestIdRef.current !== requestId) return;

          setPrice(nextPrice);

          if (nextPrice.liquidityAvailable === false) {
            setPriceStatus("error");
            setPriceError(t("swap.noLiquidity"));
            return;
          }

          if (hasZeroXBalanceIssue(nextPrice)) {
            setPriceStatus("error");
            setPriceError(t("swap.insufficientBalance"));
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
    amountMode,
    buyAmountBaseUnits,
    fromToken,
    isCrossChain,
    quoteRefreshTick,
    selectedAccount,
    selectedChainId,
    sellAmountBaseUnits,
    toToken,
  ]);

  // Auto-refresh countdown: counts down from QUOTE_REFRESH_INTERVAL_S when a quote is ready,
  // then fires a tick that causes the price effect to re-fetch.
  useEffect(() => {
    if (priceStatus !== "ready") {
      setQuoteCountdown(null);
      return;
    }

    setQuoteCountdown(QUOTE_REFRESH_INTERVAL_S);

    const intervalId = window.setInterval(() => {
      setQuoteCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          setQuoteRefreshTick((t) => t + 1);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [priceStatus]);

  // Reset import state when picker closes or chain changes; reload imported tokens when it opens
  useEffect(() => {
    if (!tokenPickerSide) {
      setTokenPickerSearch("");
      setTokenImportStatus("idle");
      setTokenImportPreview(null);
      setTokenImportError(null);
    } else {
      setImportedCustomTokens(tokenRegistryService.getTokensByChainId(selectedChainId));
      setTokenImportStatus("idle");
      setTokenImportPreview(null);
      setTokenImportError(null);
    }
  }, [tokenPickerSide, selectedChainId]);

  // Auto-trigger token import when user pastes a valid EVM address (debounced 400ms)
  useEffect(() => {
    if (!tokenPickerSide) return;
    if (tokenImportStatus !== "idle") return;
    if (!pickerHasNoResults) return;
    if (!selectedAccount) return;

    const trimmed = tokenPickerSearch.trim();
    if (!isEvmAddress(trimmed)) return;

    const chainId = selectedChainId;
    const ownerAddress = selectedAccount.address;

    const timerId = window.setTimeout(() => {
      setTokenImportStatus("fetching");
      setTokenImportError(null);
      setTokenImportPreview(null);

      tokenRegistryService
        .loadTokenPreview({ chainId, tokenAddress: trimmed, ownerAddress })
        .then((preview) => {
          setTokenImportPreview(preview);
          setTokenImportStatus("ready");
        })
        .catch((error) => {
          setTokenImportError(error instanceof Error ? error.message : String(error));
          setTokenImportStatus("error");
        });
    }, 400);

    return () => window.clearTimeout(timerId);
  }, [tokenPickerSearch, tokenPickerSide, tokenImportStatus, pickerHasNoResults, selectedAccount, selectedChainId]);

  // Auto-add the bought token to assets after a confirmed swap
  useEffect(() => {
    if (submittedSwapStatus !== "confirmed" || !toToken || toToken.type === "native") {
      return;
    }
    if (hasAutoAddedRef.current) return;

    const contractAddress = toToken.address;
    if (!contractAddress || contractAddress.toLowerCase() === ZERO_X_NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      return;
    }

    hasAutoAddedRef.current = true;

    // Always unhide
    hiddenAssetService.unhideAsset(selectedChainId, contractAddress);

    // Only add to custom tokens if not already in registry or custom list
    const isRegistered = registeredTokensForChain.some(
      (r) => r.address.toLowerCase() === contractAddress.toLowerCase(),
    );
    const existingCustom = tokenRegistryService.getTokensByChainId(selectedChainId);
    const isCustom = existingCustom.some(
      (c) => c.address.toLowerCase() === contractAddress.toLowerCase(),
    );

    if (!isRegistered && !isCustom) {
      tokenRegistryService.addToken({
        chainId: selectedChainId,
        address: contractAddress as `0x${string}`,
        symbol: toToken.symbol,
        name: toToken.name,
        decimals: toToken.decimals,
        createdAt: new Date().toISOString(),
      });

      setSwapToastMessage("Token added to assets");
      const timerId = window.setTimeout(() => setSwapToastMessage(null), 3500);
      return () => window.clearTimeout(timerId);
    }
  }, [submittedSwapStatus, toToken, selectedChainId, registeredTokensForChain]);

  // A degenerate quote: in sell mode there's nothing to receive; in buy mode
  // there's no required sell amount.
  const isZeroOutput =
    priceStatus === "ready" &&
    price != null &&
    (amountMode === "buy"
      ? !price.sellAmount || price.sellAmount === "0"
      : !price.buyAmount || price.buyAmount === "0");

  const nativeToken = useMemo(
    () => tokens.find((t) => t.type === "native") ?? null,
    [tokens],
  );

  const nativeBalanceRaw = useMemo((): bigint => {
    if (!nativeToken) return 0n;
    const raw = parseDecimalUnits(nativeToken.balance, nativeToken.decimals);
    if (!raw) return 0n;
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  }, [nativeToken]);

  const swapBalanceWarning = useMemo((): string | null => {
    if (priceStatus !== "ready" || !fromToken || !price) return null;
    const feeRaw = getNetworkFeeRaw(price);
    if (feeRaw === 0n) return null;
    const nativeSymbol = getNativeSymbol(selectedChainId);
    const isSellingNative = fromToken.type === "native";
    // In buy mode the sell side comes from the quote; in sell mode it's the
    // user's typed FROM amount.
    const sellRawSource =
      amountMode === "buy" ? price.sellAmount : sellAmountBaseUnits;
    let sellRaw = 0n;
    try {
      sellRaw = sellRawSource ? BigInt(sellRawSource) : 0n;
    } catch {
      return null;
    }
    if (isSellingNative) {
      if (sellRaw > 0n && feeRaw > sellRaw) {
        return `Network fee is higher than your swap amount. This trade is not recommended.`;
      }
      if (nativeBalanceRaw > 0n && nativeBalanceRaw < sellRaw + feeRaw) {
        return `Insufficient ${nativeSymbol} for swap amount and network fee.`;
      }
    } else {
      if (nativeBalanceRaw > 0n && nativeBalanceRaw < feeRaw) {
        return `Insufficient ${nativeSymbol} for network fee.`;
      }
    }
    return null;
  }, [amountMode, priceStatus, fromToken, price, sellAmountBaseUnits, nativeBalanceRaw, selectedChainId]);

  // The text the user is actively driving (FROM in sell mode, TO in buy mode).
  const activeAmountText = amountMode === "buy" ? receiveAmount : amount;

  const isReviewDisabled = useMemo(() => {
    const numericAmount = Number(activeAmountText);

    return (
      !selectedAccount ||
      !fromToken ||
      !toToken ||
      fromToken.address.toLowerCase() === toToken.address.toLowerCase() ||
      !activeAmountText ||
      Number.isNaN(numericAmount) ||
      numericAmount <= 0 ||
      priceStatus !== "ready" ||
      !price ||
      isZeroOutput
    );
  }, [activeAmountText, fromToken, isZeroOutput, price, priceStatus, selectedAccount, toToken]);

  // Derived display values for the calculated (non-active) side.
  const fromDerivedAmount = useMemo(() => {
    if (!fromToken || priceStatus !== "ready" || !price?.sellAmount) return "";
    return formatSwapAmount(price.sellAmount, fromToken.decimals);
  }, [fromToken, price, priceStatus]);

  const toDerivedAmount = useMemo(() => {
    if (!toToken || priceStatus !== "ready") return "";
    const value = formatEstimatedReceive(price, toToken);
    return value === "—" ? "" : value;
  }, [price, priceStatus, toToken]);

  // What each input shows: the active side echoes the user's text, the other
  // shows the quote-derived value.
  const fromInputValue = amountMode === "sell" ? amount : fromDerivedAmount;
  const toInputValue = amountMode === "buy" ? receiveAmount : toDerivedAmount;

  // FROM amount used in the review summary + history (derived in buy mode).
  const reviewPayAmount =
    amountMode === "buy"
      ? fromToken && quote?.sellAmount
        ? formatSwapAmount(quote.sellAmount, fromToken.decimals)
        : ""
      : amount;

  const estimatedReceive = useMemo(() => {
    if (!toToken) return t("swap.selectToken");
    if (priceStatus === "loading") return t("swap.fetchingQuote");
    if (priceStatus === "error") return t("swap.quoteUnavailable");

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

    if (isZeroOutput) {
      return "Quote returned zero output. Try a larger amount.";
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

  // Clear the transient quote/review/submit/approval state. Shared by the FROM
  // (sell) and TO (buy) amount change paths so both behave identically.
  function resetTransientQuoteState() {
    setMaxReserveNotice(null);
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

  function handleAmountChange(value: string) {
    setAmount(sanitizeAmountInput(value));
    resetTransientQuoteState();
  }

  function handleReceiveChange(value: string) {
    setReceiveAmount(sanitizeAmountInput(value));
    resetTransientQuoteState();
  }

  // FROM input edited → sell mode. Seeds the FROM field from the derived value
  // when leaving buy mode so the controlled value stays continuous.
  function handleSellAmountInput(value: string) {
    setSelectedPercent(null);
    setIsEditingCustom(false);
    if (amountMode !== "sell") {
      setAmountMode("sell");
      setReceiveAmount("");
    }
    handleAmountChange(value);
  }

  function handleSellAmountFocus() {
    if (amountMode === "sell") return;
    setAmountMode("sell");
    setReceiveAmount("");
    setAmount(fromDerivedAmount);
    resetTransientQuoteState();
  }

  // TO input edited → buy mode (target receive amount). Seeds from the derived
  // estimate when leaving sell mode.
  function handleReceiveAmountInput(value: string) {
    setSelectedPercent(null);
    setIsEditingCustom(false);
    if (amountMode !== "buy") {
      setAmountMode("buy");
      setAmount("");
    }
    handleReceiveChange(value);
  }

  function handleReceiveAmountFocus() {
    if (amountMode === "buy") return;
    setAmountMode("buy");
    setAmount("");
    setReceiveAmount(toDerivedAmount);
    resetTransientQuoteState();
  }

  function handleSwitchTokens() {
    if (!fromToken || !toToken) return;

    setFromToken(toToken);
    setToToken(fromToken);
    setAmount("");
    setReceiveAmount("");
    setAmountMode("sell");
    setSelectedPercent(null);
    setIsEditingCustom(false);
    setMaxReserveNotice(null);
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

  // Spendable FROM balance in base units. Native tokens reserve gas (live fee
  // ×1.5 when known, else a conservative per-chain fallback) so swaps never
  // consume the gas they need; ERC-20s spend the full balance. Returns null
  // when the balance can't be parsed, or a value that may be <= 0 when the
  // native balance is below the reserve (callers surface the warning).
  function getSpendableFromBalanceRaw(): bigint | null {
    if (!fromToken) return null;

    const balanceRawString = parseDecimalUnits(
      fromToken.balance,
      fromToken.decimals,
    );
    if (!balanceRawString) return null;

    let balanceRaw: bigint;
    try {
      balanceRaw = BigInt(balanceRawString);
    } catch {
      return null;
    }

    if (balanceRaw <= 0n) return 0n;

    // ERC-20: native gas is paid separately, never subtracted from the token.
    if (fromToken.type !== "native") return balanceRaw;

    const feeRaw = getNetworkFeeRaw(price);
    const fallbackReserve =
      NATIVE_MAX_GAS_RESERVE_WEI[selectedChainId] ??
      DEFAULT_NATIVE_MAX_GAS_RESERVE_WEI;
    const reserve = feeRaw > 0n ? (feeRaw * 3n) / 2n : fallbackReserve;

    return balanceRaw - reserve;
  }

  // MAX and percent chips always drive sell mode.
  function ensureSellModeForChips() {
    if (amountMode !== "sell") {
      setAmountMode("sell");
      setReceiveAmount("");
    }
  }

  function handleMaxClick() {
    if (!fromToken) return;

    setMaxReserveNotice(null);
    setSelectedPercent(null);
    setIsEditingCustom(false);
    ensureSellModeForChips();

    const spendable = getSpendableFromBalanceRaw();

    if (spendable === null) {
      handleAmountChange("");
      return;
    }

    if (spendable <= 0n) {
      handleAmountChange("");
      setMaxReserveNotice(
        `Not enough ${fromToken.symbol} to cover the network fee.`,
      );
      return;
    }

    handleAmountChange(formatUnitsToDecimalString(spendable, fromToken.decimals));
  }

  // Set the FROM amount to a percentage of the spendable balance. percent may
  // be fractional (custom input, e.g. 12.5). Routed through handleAmountChange
  // so the quote refetches exactly like manual entry; selectedPercent is set
  // after so the chip highlights.
  function applyPercent(percent: number) {
    if (!fromToken) return;

    setMaxReserveNotice(null);
    ensureSellModeForChips();

    const spendable = getSpendableFromBalanceRaw();

    if (spendable === null || spendable <= 0n) {
      handleAmountChange("");
      if (
        fromToken.type === "native" &&
        spendable !== null &&
        spendable <= 0n
      ) {
        setMaxReserveNotice(
          `Not enough ${fromToken.symbol} to cover the network fee.`,
        );
      }
      setSelectedPercent(percent);
      return;
    }

    // amount = spendable * percent / 100, in base units to avoid float error.
    // percent is taken to two decimals (hundredths), so divide by 10000.
    const percentHundredths = BigInt(Math.round(percent * 100));
    const portion = (spendable * percentHundredths) / 10000n;

    if (portion <= 0n) {
      handleAmountChange("");
      setSelectedPercent(percent);
      return;
    }

    handleAmountChange(formatUnitsToDecimalString(portion, fromToken.decimals));
    setSelectedPercent(percent);
  }

  // Open the inline custom-percent editor, prefilled with the last value.
  function handleStartCustomEdit() {
    if (!fromToken || fromBalanceIsZero) return;
    setCustomPercentInvalid(false);
    setCustomPercentValue(selectedPercent !== null ? String(selectedPercent) : "");
    setIsEditingCustom(true);
  }

  function handleCancelCustomEdit() {
    setIsEditingCustom(false);
    setCustomPercentInvalid(false);
  }

  // Validate + apply the inline custom percent. Accepts decimals and a comma
  // decimal separator. Empty → just close; <=0 / >100 / NaN → subtle invalid
  // border (no apply). Valid → applyPercent (same path as before: spendable
  // balance, native gas reserve, quote refetch).
  function handleApplyCustomPercent() {
    const normalized = customPercentValue.trim().replace(",", ".");

    if (normalized === "") {
      setIsEditingCustom(false);
      setCustomPercentInvalid(false);
      return;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
      setCustomPercentInvalid(true);
      return;
    }

    setCustomPercentValue(String(parsed));
    setCustomPercentInvalid(false);
    setIsEditingCustom(false);
    applyPercent(parsed);
  }

  function handleSelectToken(token: SwapToken) {
    if (tokenPickerSide === "from") {
      if (toToken && token.address.toLowerCase() === toToken.address.toLowerCase()) {
        setToToken(fromToken);
      }

      setFromToken(token);
      setAmount("");
    }

    if (tokenPickerSide === "to") {
      if (fromToken && token.address.toLowerCase() === fromToken.address.toLowerCase()) {
        setFromToken(toToken);
      }

      setToToken(token);
    }

    // Token change invalidates any calculated amounts — reset to sell mode.
    setAmount("");
    setReceiveAmount("");
    setAmountMode("sell");
    setSelectedPercent(null);
    setIsEditingCustom(false);
    setMaxReserveNotice(null);
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
    const amountFields = getQuoteAmountFields();

    if (!selectedAccount || !fromToken || !toToken || !amountFields) {
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
        ...amountFields,
        taker: selectedAccount.address,
        slippageBps,
      });

      setQuote(nextQuote);
      setReviewStatus("ready");
    } catch (error) {
      setQuoteError(normalizeSwapError(error, "quote"));
      setReviewStatus("error");
    }
  }

  async function handleApproveToken() {
    if (!quote || !fromToken || !toToken) {
      return;
    }

    // Amount to approve: the quote's sell amount (authoritative in both modes;
    // it's the only sell figure available in buy/exact-out mode).
    const approvalAmount =
      quote.sellAmount && quote.sellAmount !== "0"
        ? quote.sellAmount
        : sellAmountBaseUnits;

    if (!approvalAmount) {
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
      const approvalData = encodeErc20ApproveData(spender, approvalAmount);

      const approvalResult = await walletService.sendSelectedPreparedTransaction({
        transaction: {
          to: fromToken.address,
          data: approvalData,
          value: "0",
        },
        waitForReceipt: true,
      });

      setApprovalTxHash(approvalResult.hash);

      const refreshedAmountFields = getQuoteAmountFields() ?? {
        sellAmount: approvalAmount,
      };

      const refreshedQuote = await getSwapQuoteWithFallback({
        chainId: selectedChainId,
        sellToken: fromToken.address,
        buyToken: toToken.address,
        ...refreshedAmountFields,
        taker: selectedAccount?.address ?? "",
        slippageBps,
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
    if (!quote || !selectedAccount) return;

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
      await simulateSwapTransaction({
        chainId: selectedChainId,
        from: selectedAccount.address,
        transaction: quote.transaction,
      });

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
          amount: `${reviewPayAmount} → ${formatEstimatedReceive(quote, toToken)}`,
          fromAddress: selectedAccount.address,
          toAddress: quote.transaction.to,
          explorerUrl: result.explorerUrl,
          createdAt: new Date().toISOString(),
          swapFromSymbol: fromToken.symbol,
          swapFromAmount: reviewPayAmount,
          swapToSymbol: toToken.symbol,
          swapToAmount: formatEstimatedReceive(quote, toToken),
          swapRoute: getZeroXRouteLabel(quote),
          swapSimpleFee: formatSimpleFeeAmount(quote, fromToken, toToken),
          swapNetworkFee: formatNetworkFee(quote, selectedChainId),
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

  function handleBackToWalletAfterSubmit() {
    setSubmitStatus("idle");
    setIsReviewOpen(false);
    void onSwapCompleted?.();
    // Always go to the wallet Home screen — never the previous in-flow screen.
    (onNavigateHome ?? onBack)();
  }

  // Failed → back to the swap editor with From/To tokens and amount intact so
  // the user can adjust and retry. Closes the status screen and the review
  // panel without clearing the quote inputs (no handleNewSwap reset).
  function handleTryAgainAfterFailedSwap() {
    setSubmitStatus("idle");
    setIsReviewOpen(false);
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

  // Derived validation/state for the custom slippage input. `parsed` is the
  // clamped bps for a valid entry, or null when the value can't be parsed. The
  // field is only flagged as an error once the user has typed something invalid;
  // Apply is disabled while the value is invalid or unchanged from the applied
  // slippage (so it never re-applies the same number or an invalid one).
  const parsedCustomSlippageBps = parseSlippagePercentInput(customSlippagePercent);
  const isCustomSlippageInvalid =
    customSlippagePercent.trim().length > 0 && parsedCustomSlippageBps === null;
  const canApplyCustomSlippage =
    parsedCustomSlippageBps !== null && parsedCustomSlippageBps !== slippageBps;
  const SLIPPAGE_PRESETS_BPS = [10, 50, 100];

  function handleNewSwap() {
    hasAutoAddedRef.current = false;
    setAmount("");
    setReceiveAmount("");
    setAmountMode("sell");
    setSelectedPercent(null);
    setIsEditingCustom(false);
    setCustomPercentValue("");
    setCustomPercentInvalid(false);
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

  function handleConfirmImport() {
    if (!tokenImportPreview) return;

    const customToken: CustomToken = {
      chainId: tokenImportPreview.chainId,
      address: tokenImportPreview.address,
      symbol: tokenImportPreview.symbol,
      name: tokenImportPreview.name,
      decimals: tokenImportPreview.decimals,
      createdAt: tokenImportPreview.createdAt,
    };

    tokenRegistryService.addToken(customToken);
    hiddenAssetService.unhideAsset(tokenImportPreview.chainId, tokenImportPreview.address);

    handleSelectToken(customToSwapToken(customToken));
  }

  const pickerTitle =
    tokenPickerSide === "from"
      ? t("swap.selectTokenToSell")
      : t("swap.selectTokenToReceive");

  const ctaLabel = (() => {
    if (!amount || Number(amount) <= 0) return t("swap.enterAmount");
    if (priceStatus === "loading") return t("swap.gettingQuote");
    return t("swap.reviewSwap");
  })();

  // Network selection — the shared full-screen selector (no modal/sheet).
  // Back returns to Swap unchanged; selecting switches the network and resets
  // the quote/token pair for the new chain.
  if (networkSelectorOpen) {
    return (
      <SelectNetworkPage
        purpose="swap"
        selectedChainId={selectedChainId}
        onSelect={(chainId) => void selectNetwork(chainId)}
        onBack={() => setNetworkSelectorOpen(false)}
      />
    );
  }

  if (isWatchOnly(selectedAccount)) {
    return (
      <div className="ext-popup swap-page" data-screen-label="Swap – Watch-only">
        <div className="bar-top">
          <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            {t("swap.title")}
          </div>
        </div>
        <div className="screen-body watch-only-guard">
          <div className="watch-only-guard__title">{t("send.watchOnlyTitle")}</div>
          <div className="watch-only-guard__text">
            {t("swap.watchOnlyCannotSwap")}
          </div>
          <button className="btn secondary lg full" type="button" onClick={onBack}>
            {t("common.backToWallet")}
          </button>
        </div>
      </div>
    );
  }

  // Cross-chain swap: the chosen destination chain differs from the source.
  // Hand off to the LI.FI-backed cross-chain panel (still titled "Swap"). When
  // the user collapses the pair back to one chain, we return here to the
  // same-chain flow so 0x / Jupiter always own same-chain routing.
  if (isCrossChain) {
    return (
      <BridgePage
        selectedAccount={selectedAccount}
        walletState={walletState}
        onNavigateHome={onNavigateHome}
        initialFromChainId={selectedChainId}
        initialToChainId={destChainId}
        // Preserve the user's SOURCE token + amount across the same-chain →
        // cross-chain handoff. Without this BridgePage defaulted the FROM token
        // for the source chain, wiping the user's pick when they chose a TO token
        // on another network. Native → LI.FI's 0x0 native sentinel (BridgePage
        // reconciles non-EVM identifiers by symbol on load); ERC-20 keeps its
        // contract address. Amount is carried over verbatim.
        initialAmount={fromInputValue}
        initialFromToken={
          fromToken
            ? {
                chainId: selectedChainId,
                address:
                  fromToken.type === "native"
                    ? LIFI_NATIVE_ADDRESS
                    : fromToken.address,
                symbol: fromToken.symbol,
                name: fromToken.name,
                decimals: fromToken.decimals,
                isNative: fromToken.type === "native",
                logoUrl: null,
              }
            : null
        }
        initialToToken={
          pendingToToken && pendingToToken.chainId === destChainId
            ? {
                chainId: pendingToToken.chainId,
                address: pendingToToken.address,
                symbol: pendingToToken.symbol,
                name: pendingToToken.name,
                decimals: pendingToToken.decimals,
                isNative: pendingToToken.isNative,
                logoUrl: pendingToToken.logoUrl ?? null,
              }
            : null
        }
        onSameChainSelected={(chainId) => void handleCrossChainCollapse(chainId)}
        onBridgeCompleted={onSwapCompleted}
        onBack={() => {
          setPendingToToken(null);
          setDestChainId(selectedChainId);
        }}
      />
    );
  }

  // Solana is not part of the EVM 0x swap flow — it has its own Simpl-API
  // (Jupiter-backed) swap screen, left entirely unchanged. Solana-source
  // cross-chain routes are reachable from the cross-chain panel's own From
  // picker (which carries the correct LI.FI chain id).
  if (isSolanaChainId(selectedChainId)) {
    return (
      <SolanaSwapPage
        selectedAccount={selectedAccount}
        walletState={walletState}
        selectedChainId={selectedChainId}
        onBack={onBack}
        onSwapCompleted={onSwapCompleted}
        initialToAsset={initialToAsset}
      />
    );
  }

  return (
    <div className="ext-popup swap-page" data-screen-label="Swap">
      {/* ── Top bar ── */}
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          type="button"
          className="swap-page-title swap-page-title--button"
          onClick={() => setNetworkSelectorOpen(true)}
          aria-label={t("receive.changeNetwork", { label: getNetworkLabel(selectedChainId) })}
        >
          <div className="swap-page-title__name">{t("swap.title")}</div>
          <div className="swap-page-title__network">
            {getNetworkLabel(selectedChainId)}
            <span className="swap-page-title__chevron" aria-hidden="true">▾</span>
          </div>
        </button>

        <button
          className="icbtn"
          type="button"
          aria-label={t("swap.settingsWithSlippage", { value: formatSlippageBps(slippageBps) })}
          onClick={() => {
            setCustomSlippagePercent(String(slippageBps / 100));
            setIsSwapSettingsOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A8.6 8.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8.6 8.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5z" />
          </svg>
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div
        className="screen-body"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        {tokenError ? (
          <div className="swap-error">{t("swap.couldNotLoadTokens", { error: tokenError })}</div>
        ) : null}

        {/* Combined From / To card */}
        <div className="swap-pair-card">
          {/* FROM half */}
          <div className="swap-half swap-half--from">
            <div className="swap-half-top">
              <span className="swap-half-label">{t("swap.from")}</span>
              <div className="swap-half-selectors">
                <button
                  className="swap-token-pill"
                  type="button"
                  onClick={() => setTokenPickerSide("from")}
                  disabled={isLoadingTokens && tokens.length === 0}
                >
                  {fromToken ? (
                    <TokenWithChainBadge
                      symbol={fromToken.symbol}
                      tokenAddress={fromToken.type === "native" ? null : fromToken.address}
                      chainId={selectedChainId}
                      chainName={getNetworkLabel(selectedChainId)}
                      size={28}
                    />
                  ) : (
                    <span className="swap-token-pill__icon">?</span>
                  )}
                  <span className="swap-token-pill__sym">{fromToken?.symbol ?? t("swap.select")}</span>
                  <span className="swap-token-pill__chevron">▾</span>
                </button>
              </div>
            </div>

            <input
              className="swap-amount-input"
              inputMode="decimal"
              placeholder="0"
              value={fromInputValue}
              onFocus={handleSellAmountFocus}
              onChange={(event) => handleSellAmountInput(event.target.value)}
              style={{
                fontSize: getAmountFontSize(fromInputValue || "0"),
                letterSpacing: getAmountLetterSpacing(fromInputValue || "0"),
                lineHeight: 1.05,
              }}
            />

            <div className="swap-half-bottom">
              <span>{fromToken?.name ?? "—"}</span>
              {fromToken ? (
                <span className="swap-half-bottom__bal">
                  {hideBalances ? "••••" : formatTokenBalance(fromToken.balance)}{" "}
                  {fromToken.symbol}
                </span>
              ) : null}
            </div>

            {/* Custom percent + MAX live inside FROM, near the balance. */}
            <div className="swap-from-chips">
              {isEditingCustom ? (
                <span
                  className={`swap-percent-chip swap-percent-chip--edit${
                    customPercentInvalid ? " swap-percent-chip--invalid" : ""
                  }`}
                >
                  <input
                    className="swap-percent-chip__input"
                    inputMode="decimal"
                    autoFocus
                    placeholder="0"
                    value={customPercentValue}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      setCustomPercentValue(event.target.value);
                      setCustomPercentInvalid(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleApplyCustomPercent();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        handleCancelCustomEdit();
                      }
                    }}
                    onBlur={handleApplyCustomPercent}
                  />
                  <span className="swap-percent-chip__suffix">%</span>
                  <button
                    type="button"
                    className="swap-percent-chip__apply"
                    aria-label={t("swap.applyCustomPercent")}
                    // Keep input focus so the click applies before onBlur fires.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleApplyCustomPercent}
                  >
                    ✓
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className={`swap-percent-chip swap-percent-chip--custom${
                    amountMode === "sell" && selectedPercent !== null
                      ? " swap-percent-chip--active"
                      : ""
                  }`}
                  onClick={handleStartCustomEdit}
                  disabled={!fromToken || fromBalanceIsZero}
                  aria-label={t("swap.customPercentOfBalance")}
                  title={t("swap.customPercentOfBalance")}
                >
                  {amountMode === "sell" && selectedPercent !== null
                    ? `${selectedPercent}%`
                    : "✎"}
                </button>
              )}

              <button
                className="swap-max-pill swap-percent-chip"
                type="button"
                onClick={handleMaxClick}
                disabled={!fromToken || fromBalanceIsZero}
              >
                {t("common.max")}
              </button>
            </div>
          </div>

          {/* Switch divider */}
          <div className="swap-divider">
            <button
              className="swap-switch-btn"
              type="button"
              onClick={handleSwitchTokens}
              disabled={!fromToken || !toToken}
              aria-label={t("swap.switchTokens")}
            >
              ↕
            </button>
          </div>

          {/* TO half */}
          <div className="swap-half swap-half--to">
            <div className="swap-half-top">
              <span className="swap-half-label">{t("swap.to")}</span>
              <div className="swap-half-selectors">
                <button
                  className="swap-token-pill"
                  type="button"
                  onClick={() => setCrossToPickerOpen(true)}
                  disabled={isLoadingTokens && tokens.length === 0}
                >
                  {toToken ? (
                    <TokenWithChainBadge
                      symbol={toToken.symbol}
                      tokenAddress={toToken.type === "native" ? null : toToken.address}
                      chainId={selectedChainId}
                      chainName={getNetworkLabel(selectedChainId)}
                      size={28}
                    />
                  ) : (
                    <span className="swap-token-pill__icon">?</span>
                  )}
                  <span className="swap-token-pill__sym">{toToken?.symbol ?? t("swap.select")}</span>
                  <span className="swap-token-pill__chevron">▾</span>
                </button>
              </div>
            </div>

            <input
              className={`swap-amount-input${
                amountMode === "buy" ? " swap-amount-input--target" : ""
              }`}
              inputMode="decimal"
              placeholder="0"
              value={toInputValue}
              onFocus={handleReceiveAmountFocus}
              onChange={(event) => handleReceiveAmountInput(event.target.value)}
              disabled={!toToken}
              title={amountMode === "sell" ? estimatedReceive : undefined}
              style={{
                fontSize: getAmountFontSize(toInputValue || "0"),
                letterSpacing: getAmountLetterSpacing(toInputValue || "0"),
                lineHeight: 1.05,
              }}
            />

            <div className="swap-half-bottom">
              <span>
                {amountMode === "buy" ? t("swap.youReceive") : toToken?.name ?? "—"}
              </span>
              {toToken ? (
                <span className="swap-half-bottom__bal">
                  {hideBalances ? "••••" : formatTokenBalance(toToken.balance)}{" "}
                  {toToken.symbol}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Quote details — only shown once a quote is being fetched or is ready */}
        {priceStatus !== "idle" ? (
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>{t("swap.rate")}</span>
              <strong>{formatRate(price, fromToken, toToken)}</strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.networkFee")}</span>
              <strong>{formatNetworkFee(price, selectedChainId)}</strong>
            </div>
            <div className="swap-quote-row swap-quote-row--route">
              <span>{t("swap.route")}</span>
              <strong title={priceStatus === "ready" ? getZeroXRouteLabel(price) : undefined}>
                {priceStatus === "ready" ? getZeroXRouteLabel(price) : "—"}
              </strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.simplFee")}</span>
              <strong>
                {/* Backend-authoritative: display the fee the API returned, never
                    a client-configured bps. "—" until the quote loads or when the
                    breakdown is unavailable (never assumed 0). */}
                {priceStatus === "ready"
                  ? formatSimpleFeeAmount(price, fromToken, toToken) ?? "—"
                  : "—"}
              </strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.minimumReceived")}</span>
              <strong>{formatMinReceived(price, toToken)}</strong>
            </div>
          </div>
        ) : null}

        {/* Status notice — errors always show; the loading hint shows while a
            quote is fetching. The success/"quote ready" notice is intentionally
            omitted: the active black Review button is confirmation enough and
            it saves vertical space in the popup. */}
        {priceStatus === "error" ? (
          <div className="swap-error">{quoteNotice}</div>
        ) : priceStatus === "loading" && !swapBalanceWarning ? (
          <div className="swap-notice">{quoteNotice}</div>
        ) : null}

        {/* Balance / gas warning */}
        {swapBalanceWarning ? (
          <div className="swap-warning">{swapBalanceWarning}</div>
        ) : null}

        {/* MAX could not reserve gas (balance too low for the network fee) */}
        {maxReserveNotice ? (
          <div className="swap-warning">{maxReserveNotice}</div>
        ) : null}

        {/* Auto-refresh countdown */}
        {priceStatus === "ready" && quoteCountdown !== null ? (
          <div className="swap-quote-refresh">
            {t("swap.quoteRefreshesIn", { seconds: quoteCountdown })}
          </div>
        ) : null}

        {/* Review CTA — last block in normal flow; never scrolls or overlaps */}
        <div className="swap-review-cta">
          <button
            className="btn primary lg full"
            type="button"
            disabled={isReviewDisabled}
            onClick={handleOpenReview}
          >
            {ctaLabel}
          </button>
        </div>
      </div>

      {/* Post-swap toast */}
      {swapToastMessage ? (
        <div className="swap-toast">{swapToastMessage}</div>
      ) : null}

      {submitStatus === "submitted" ? (
        <div
          className={`swap-status-page swap-status-page--${submittedSwapStatus}`}
          role="dialog"
          aria-modal="true"
          aria-label={getSubmittedSwapStatusTitle(submittedSwapStatus)}
        >
          {/* Header — full wallet screen, not a modal */}
          <div className="swap-status-header">
            <button
              className="icbtn"
              type="button"
              onClick={handleBackToWalletAfterSubmit}
              aria-label={t("common.backToWallet")}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="swap-status-titles">
              <div className="swap-status-title">
                {getSubmittedSwapStatusTitle(submittedSwapStatus)}
              </div>
              <div className="swap-status-subtitle">
                {getSubmittedSwapStatusSubtitle(submittedSwapStatus)}
              </div>
            </div>

            <span className="swap-status-spacer" aria-hidden="true" />
          </div>

          <div className="swap-status-content">
            {/* Compact status card */}
            <div
              className={`swap-status-card swap-status-card--${submittedSwapStatus}`}
            >
              <div className="swap-status-icon">
                {submittedSwapStatus === "pending" ? (
                  <span className="swap-status-spinner" aria-hidden="true" />
                ) : (
                  getSubmittedSwapStatusIcon(submittedSwapStatus)
                )}
              </div>
              <div className="swap-status-text">
                <strong>{getSubmittedSwapStatusCardTitle(submittedSwapStatus)}</strong>
                <p>
                  {submittedSwapStatus === "failed" && submittedSwapError
                    ? submittedSwapError
                    : getSubmittedSwapStatusCardText(submittedSwapStatus)}
                </p>
              </div>
            </div>

            {/* Transaction details */}
            <div className="swap-status-details">
              <div className="swap-details-row">
                <span>{t("swap.youPaid")}</span>
                <strong>
                  {reviewPayAmount} {fromToken?.symbol ?? ""}
                </strong>
              </div>

              <div className="swap-details-row">
                <span>
                  {submittedSwapStatus === "confirmed"
                    ? t("swap.youReceived")
                    : submittedSwapStatus === "failed"
                      ? t("swap.youExpected")
                      : t("swap.youReceive")}
                </span>
                <strong>
                  {quote && toToken
                    ? `${formatEstimatedReceive(quote, toToken)} ${toToken.symbol}`
                    : "—"}
                </strong>
              </div>

              <div className="swap-details-row">
                <span>{t("common.status")}</span>
                <strong>
                  <span
                    className={`swap-status-badge swap-status-badge--${submittedSwapStatus}`}
                  >
                    {getSubmittedSwapStatusLabel(submittedSwapStatus)}
                  </span>
                </strong>
              </div>

              {submittedSwapStatus === "confirmed" ? (
                <div className="swap-details-row">
                  <span>{t("swap.simplFee")}</span>
                  <strong>
                    {quote ? formatSimpleFeeAmount(quote, fromToken, toToken) : "—"}
                  </strong>
                </div>
              ) : null}

              <div className="swap-details-row">
                <span>{t("swap.networkFee")}</span>
                <strong>{quote ? formatNetworkFee(quote, selectedChainId) : "—"}</strong>
              </div>

              {submittedSwapStatus !== "confirmed" ? (
                <div className="swap-details-row">
                  <span>{t("swap.route")}</span>
                  <strong title={quote ? getZeroXRouteLabel(quote) : undefined}>
                    {quote ? getZeroXRouteLabel(quote) : "—"}
                  </strong>
                </div>
              ) : null}

              <div className="swap-details-row">
                <span>{t("swap.txHash")}</span>
                <strong
                  className="swap-status-hash"
                  title={submittedTxHash ?? undefined}
                >
                  {formatShortTransactionHash(submittedTxHash)}
                </strong>
              </div>
            </div>
          </div>

          <div className="swap-status-actions">
            {submittedSwapStatus === "failed" ? (
              <>
                <button
                  className="btn primary lg full swap-status-primary"
                  type="button"
                  onClick={handleTryAgainAfterFailedSwap}
                >
                  {t("common.retry")}
                </button>

                <button
                  className="btn secondary lg full swap-status-secondary"
                  type="button"
                  onClick={handleBackToWalletAfterSubmit}
                >
                  {t("common.backToWallet")}
                </button>

                {submittedExplorerUrl ? (
                  <a
                    className="swap-status-tertiary"
                    href={submittedExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("common.viewOnExplorer")}
                  </a>
                ) : null}
              </>
            ) : (
              <>
                {submittedExplorerUrl ? (
                  <a
                    className="btn primary lg full swap-status-primary"
                    href={submittedExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("common.viewOnExplorer")}
                  </a>
                ) : null}

                <button
                  className="btn secondary lg full swap-status-secondary"
                  type="button"
                  onClick={handleBackToWalletAfterSubmit}
                >
                  {t("common.backToWallet")}
                </button>

                {submittedSwapStatus === "confirmed" ? (
                  <button
                    className="swap-status-tertiary"
                    type="button"
                    onClick={handleStartNewSwapAfterSubmit}
                  >
                    {t("swap.newSwap")}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {isSwapSettingsOpen ? (
        <div
          className="swap-settings-backdrop"
          onClick={() => setIsSwapSettingsOpen(false)}
        >
          <div
            className="swap-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("swap.settings.title")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="swap-settings-modal__header">
              <div className="swap-settings-modal__heading">
                <h2 className="swap-settings-modal__title">
                  {t("swap.settings.title")}
                </h2>
                <p className="swap-settings-modal__subtitle">
                  {t("swap.settings.subtitle")}
                </p>
              </div>

              <button
                className="icbtn swap-settings-modal__close"
                type="button"
                aria-label={t("swap.settings.close")}
                onClick={() => setIsSwapSettingsOpen(false)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <section className="swap-settings-section">
              <div className="swap-settings-row">
                <strong className="swap-settings-row__label">
                  {t("swap.settings.maxSlippage")}
                </strong>
                <span className="swap-settings-row__current">
                  {t("swap.settings.current", {
                    value: formatSlippageBps(slippageBps),
                  })}
                </span>
              </div>

              <div className="swap-slippage-presets">
                {SLIPPAGE_PRESETS_BPS.map((presetBps) => {
                  const active = slippageBps === presetBps;
                  return (
                    <button
                      key={presetBps}
                      type="button"
                      className={`swap-slippage-preset${
                        active ? " swap-slippage-preset--active" : ""
                      }`}
                      aria-pressed={active}
                      onClick={() => handlePresetSlippage(presetBps)}
                    >
                      {active ? (
                        <svg
                          className="swap-slippage-preset__check"
                          viewBox="0 0 24 24"
                          width="13"
                          height="13"
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      ) : null}
                      {formatSlippageBps(presetBps)}
                    </button>
                  );
                })}
              </div>

              <div className="swap-settings-custom">
                <label
                  className="swap-settings-custom__label"
                  htmlFor="swap-custom-slippage"
                >
                  {t("swap.settings.customSlippage")}
                </label>

                <div className="swap-settings-custom__row">
                  <div
                    className={`swap-settings-custom__field${
                      isCustomSlippageInvalid
                        ? " swap-settings-custom__field--error"
                        : ""
                    }`}
                  >
                    <input
                      id="swap-custom-slippage"
                      inputMode="decimal"
                      placeholder="0.5"
                      value={customSlippagePercent}
                      aria-invalid={isCustomSlippageInvalid}
                      onChange={(event) =>
                        setCustomSlippagePercent(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && canApplyCustomSlippage) {
                          handleApplyCustomSlippage();
                        }
                      }}
                    />
                    <span
                      className="swap-settings-custom__suffix"
                      aria-hidden="true"
                    >
                      %
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn secondary swap-settings-custom__apply"
                    disabled={!canApplyCustomSlippage}
                    onClick={handleApplyCustomSlippage}
                  >
                    {t("swap.settings.apply")}
                  </button>
                </div>

                {isCustomSlippageInvalid ? (
                  <div className="swap-settings-error">
                    {t("swap.settings.invalidSlippage")}
                  </div>
                ) : (
                  <div className="swap-settings-hint">
                    {t("swap.settings.riskHint")}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {isReviewOpen ? (
        <div
          className="swap-review-page"
          role="dialog"
          aria-modal="true"
          aria-label={t("swap.reviewSwap")}
        >
          {/* Header — full wallet screen, not a modal */}
          <div className="swap-review-page__header">
            <button
              className="icbtn"
              type="button"
              onClick={handleCloseReview}
              aria-label={t("swap.backToSwap")}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="swap-review-page__titles">
              <div className="swap-review-page__title">{t("swap.reviewSwap")}</div>
              <div className="swap-review-page__subtitle">
                {t("swap.slippage")} {formatSlippageBps(slippageBps)}
              </div>
            </div>

            <span className="swap-review-page__spacer" aria-hidden="true" />
          </div>

          {reviewStatus === "loading" ? (
            <div className="swap-review-page__content">
              <div className="swap-empty-state">{t("swap.fetchingQuote")}</div>
            </div>
          ) : null}

          {reviewStatus === "error" ? (
            <div className="swap-review-page__content">
              <section className="swap-error">
                {quoteError ?? t("swap.quoteFailed")}
              </section>
            </div>
          ) : null}

          {reviewStatus === "ready" && quote && fromToken && toToken ? (
            <>
              <div className="swap-review-page__content">
                {/* Compact pay / receive summary */}
                <div className="swap-review-summary">
                  <div className="swap-review-summary__row">
                    <span className="swap-review-summary__label">{t("swap.youPay")}</span>
                    <strong className="swap-review-summary__amount">
                      {reviewPayAmount} {fromToken.symbol}
                    </strong>
                  </div>

                  <div className="swap-review-summary__divider" />

                  <div className="swap-review-summary__row">
                    <span className="swap-review-summary__label">{t("swap.youReceive")}</span>
                    <strong className="swap-review-summary__amount">
                      {formatEstimatedReceive(quote, toToken)} {toToken.symbol}
                    </strong>
                  </div>
                </div>

                {/* Quote details */}
                <div className="swap-review-details">
                  <div className="swap-details-row">
                    <span>{t("swap.rate")}</span>
                    <strong title={formatRate(quote, fromToken, toToken)}>
                      {formatRate(quote, fromToken, toToken)}
                    </strong>
                  </div>

                  <div className="swap-details-row">
                    <span>{t("swap.minimumReceived")}</span>
                    <strong>{formatMinReceived(quote, toToken)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>{t("swap.networkFee")}</span>
                    <strong>{formatNetworkFee(quote, selectedChainId)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>{t("swap.route")}</span>
                    <strong title={getZeroXRouteLabel(quote)}>
                      {getZeroXRouteLabel(quote)}
                    </strong>
                  </div>

                  <div className="swap-details-row">
                    <span>{t("swap.simplFee")}</span>
                    <strong>{formatSimpleFeeAmount(quote, fromToken, toToken)}</strong>
                  </div>

                  <div className="swap-details-row">
                    <span>{t("swap.approval")}</span>
                    <strong>{needsApproval ? t("swap.approvalRequired") : t("swap.approvalNotNeeded")}</strong>
                  </div>

                  <p className="swap-review-fee-note">
                    {t("swap.feeMayChange")}
                  </p>
                </div>

                {isApprovalApproved && approvalTxHash ? (
                  <section className="swap-success">
                    <strong>{t("swap.approvalConfirmed")}</strong>
                    <span>{approvalTxHash}</span>
                  </section>
                ) : null}

                {approvalStatus === "error" && approvalError ? (
                  <section className="swap-error">{approvalError}</section>
                ) : null}

                {submitStatus === "error" && submitError ? (
                  <section className="swap-error">{submitError}</section>
                ) : null}
              </div>

              <div className="swap-review-page__footer">
                {needsApproval ? (
                  <button
                    className="btn primary lg full swap-review-confirm"
                    type="button"
                    onClick={() => void handleApproveToken()}
                    disabled={approvalStatus === "approving" || isApprovalApproved}
                  >
                    {approvalStatus === "approving"
                      ? t("swap.approving")
                      : t("swap.approve", { symbol: fromToken.symbol })}
                  </button>
                ) : (
                  <button
                    className="btn primary lg full swap-review-confirm"
                    type="button"
                    onClick={() => void handleConfirmSwap()}
                    disabled={
                      submitStatus === "submitting" || submitStatus === "submitted"
                    }
                  >
                    {submitStatus === "submitting"
                      ? t("swap.submittingSwap")
                      : t("swap.confirmSwap")}
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Cross-network "To" token picker — selecting a token on another
          network turns the swap into a cross-chain (LI.FI) route. ── */}
      {crossToPickerOpen ? (
        <CrossChainTokenPicker
          side="to"
          currentChainId={selectedChainId}
          onSelect={handlePickToToken}
          onClose={() => setCrossToPickerOpen(false)}
        />
      ) : null}

      {/* ── Token picker modal with search + import (FROM, current network) ── */}
      {tokenPickerSide ? (
        <div className="swap-token-picker-page" role="dialog" aria-modal="true">
          <SwapHeader
            title={pickerTitle}
            subtitle={getNetworkLabel(selectedChainId)}
            onBack={() => setTokenPickerSide(null)}
          />

          <div className="cc-picker-sticky">
            {/* Search input */}
            <div className="swap-picker-search">
              <input
                type="text"
                placeholder={t("swap.searchTokenPlaceholder")}
                value={tokenPickerSearch}
                autoFocus
                onChange={(e) => {
                  setTokenPickerSearch(e.target.value);
                  setTokenImportStatus("idle");
                  setTokenImportPreview(null);
                  setTokenImportError(null);
                }}
              />
            </div>
          </div>

          <div className="cc-picker-body">
            {/* Import flow — replaces list when active */}
            {tokenImportStatus !== "idle" ? (
              <div className="swap-token-import-panel">
                {tokenImportStatus === "fetching" ? (
                  <div className="swap-empty-state">{t("swap.checkingToken")}</div>
                ) : null}

                {tokenImportStatus === "error" ? (() => {
                  const similarToken = findSimilarRegisteredToken(
                    tokenPickerSearch.trim(),
                    registeredTokensForChain,
                  );
                  return (
                    <>
                      <div className="swap-error">{tokenImportError}</div>
                      <div className="swap-import-error-hint">
                        {t("swap.importErrorHint")}
                      </div>
                      {similarToken ? (
                        <button
                          className="swap-import-did-you-mean"
                          type="button"
                          onClick={() => {
                            setTokenPickerSearch(similarToken.symbol);
                            setTokenImportStatus("idle");
                            setTokenImportError(null);
                            setTokenImportPreview(null);
                          }}
                        >
                          {t("swap.didYouMean", { symbol: similarToken.symbol })}
                        </button>
                      ) : null}
                      <button
                        className="swap-picker-back-btn"
                        type="button"
                        onClick={() => {
                          setTokenImportStatus("idle");
                          setTokenImportError(null);
                        }}
                      >
                        ← {t("swap.backToSearch")}
                      </button>
                    </>
                  );
                })() : null}

                {tokenImportStatus === "ready" && tokenImportPreview ? (
                  <>
                    <div className="swap-token-import-card">
                      <AssetIcon
                        ticker={tokenImportPreview.symbol}
                        address={tokenImportPreview.address}
                        chainId={selectedChainId}
                        size={32}
                        className="swap-token-list-img"
                      />
                      <span className="swap-token-list-body">
                        <strong>{tokenImportPreview.symbol}</strong>
                        <span>
                          {tokenImportPreview.name} · {truncatePickerAddress(tokenImportPreview.address)}
                        </span>
                      </span>
                    </div>
                    <div className="swap-warning">
                      ⚠ {t("swap.importWarning")}
                    </div>
                    <button
                      className="swap-review-button"
                      type="button"
                      onClick={handleConfirmImport}
                    >
                      {t("swap.importAndSelect")}
                    </button>
                    <button
                      className="swap-picker-back-btn"
                      type="button"
                      onClick={() => {
                        setTokenImportStatus("idle");
                        setTokenImportPreview(null);
                      }}
                    >
                      ← {t("swap.backToSearch")}
                    </button>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="swap-token-list">
                {/* Your assets */}
                {pickerWallet.length > 0 ? (
                  <>
                    {(pickerPopular.length > 0 || pickerImported.length > 0) ? (
                      <div className="swap-token-section-label">{t("swap.yourAssets")}</div>
                    ) : null}
                    {pickerWallet.map((token) => (
                      <button
                        key={token.id}
                        className="swap-token-list-item"
                        type="button"
                        onClick={() => handleSelectToken(token)}
                      >
                        <AssetIcon
                          ticker={token.symbol}
                          address={token.type === "native" ? null : token.address}
                          chainId={selectedChainId}
                          size={32}
                          className="swap-token-list-img"
                        />
                        <span className="swap-token-list-body">
                          <strong>{token.symbol}</strong>
                          <span>{token.name}</span>
                        </span>
                        <span className="swap-token-list-balance">
                          {hideBalances ? "••••" : formatTokenBalance(token.balance)}
                        </span>
                      </button>
                    ))}
                  </>
                ) : null}

                {/* Popular */}
                {pickerPopular.length > 0 ? (
                  <>
                    <div className="swap-token-section-label">{t("swap.popular")}</div>
                    {pickerPopular.map((token) => (
                      <button
                        key={token.id}
                        className="swap-token-list-item"
                        type="button"
                        onClick={() => handleSelectToken(token)}
                      >
                        <AssetIcon
                          ticker={token.symbol}
                          address={token.type === "native" ? null : token.address}
                          chainId={selectedChainId}
                          size={32}
                          className="swap-token-list-img"
                        />
                        <span className="swap-token-list-body">
                          <strong>{token.symbol}</strong>
                          <span>{token.name}</span>
                        </span>
                        <span className="swap-token-list-balance">—</span>
                      </button>
                    ))}
                  </>
                ) : null}

                {/* Imported */}
                {pickerImported.length > 0 ? (
                  <>
                    <div className="swap-token-section-label">{t("accounts.imported")}</div>
                    {pickerImported.map((token) => (
                      <button
                        key={token.id}
                        className="swap-token-list-item"
                        type="button"
                        onClick={() => handleSelectToken(token)}
                      >
                        <AssetIcon
                          ticker={token.symbol}
                          address={token.type === "native" ? null : token.address}
                          chainId={selectedChainId}
                          size={32}
                          className="swap-token-list-img"
                        />
                        <span className="swap-token-list-body">
                          <strong>{token.symbol}</strong>
                          <span>{token.name}</span>
                        </span>
                        <span className="swap-token-list-balance">—</span>
                      </button>
                    ))}
                  </>
                ) : null}

                {/* Empty state — shows "Checking token…" during the 400ms debounce */}
                {pickerHasNoResults ? (
                  <div className="swap-empty-state">
                    {isLoadingTokens
                      ? t("swap.loadingTokens")
                      : isEvmAddress(tokenPickerSearch.trim()) && tokenImportStatus === "idle"
                        ? t("swap.checkingToken")
                        : tokenPickerSearch
                          ? t("swap.noTokensTryImport")
                          : t("swap.noVisibleAssets")}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SwapPage;
