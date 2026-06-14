// src/popup/routes/BridgePage.tsx
//
// Native cross-chain Bridge flow, powered end-to-end by the Simpl API LI.FI
// proxy (src/core/bridge/lifi-bridge.service). The extension NEVER calls LI.FI
// directly and never sees API keys / referral accounts / raw provider payloads.
//
// Execution is deliberately scoped:
//   • EVM → * routes whose SOURCE chain the wallet can sign (the chains in the
//     local registry) are executable: approve (if ERC-20) → confirm → submit.
//   • Any other source (Solana / TRON / an EVM chain without a configured RPC)
//     is shown as a quote PREVIEW only — Confirm is disabled and a clear,
//     non-blocking "execution coming soon" message is shown. We never fabricate
//     signing support for a chain we can't sign.
//
// The flow mirrors SolanaSwapPage (form → review → success) and reuses the
// shared Swap design-system classes so it feels native to the wallet.

import { useEffect, useMemo, useRef, useState } from "react";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import { transactionHistoryService } from "../../core/transactions/transaction-history.service";
import {
  getBridgeChains,
  getBridgeTokens,
  getBridgeQuote,
  prepareBridgeTransaction,
  getBridgeStatus,
  isSignableSourceChain,
  readErc20Allowance,
  NoBridgeRouteError,
  LIFI_SOLANA_CHAIN_ID,
  LIFI_TRON_CHAIN_ID,
  bridgeDebugLog,
  classifyAddressType,
  type BridgeChain,
  type BridgeToken,
  type BridgeQuote,
} from "../../core/bridge/lifi-bridge.service";
import { readTrc20Allowance } from "../../chains/tron/tron.bridge";
import { TronError } from "../../chains/tron/tron.errors";
import { isValidTronAddress } from "../../chains/tron/tron.address";
import {
  SOLANA_MAINNET,
  SOL_FEE_RESERVE_LAMPORTS,
  getSolanaTransactionExplorerUrl,
} from "../../chains/solana/solana.config";
import { SolanaError } from "../../chains/solana/solana.errors";
import {
  logSolanaInvariantAfterGating,
  getLastSolanaInstructionFailure,
  isBridgeDebugEnabled,
  detectWsolSetupNeed,
} from "../../chains/solana/solana.bridge";
import { getSolBalance } from "../../chains/solana/solana.balance";
import { getSplTokenBalanceByMint } from "../../chains/solana/solana.tokens";
import { getTrxBalance, getTrc20Balance } from "../../chains/tron/tron.balance";
import { fromBaseUnits as tronFromBaseUnits } from "../../chains/tron/tron.format";
import { SOL_WSOL_MINT } from "../../core/swaps/solana-swap.service";
import {
  resolveChainTokenBalance,
  LOADING_BALANCE,
  UNAVAILABLE_BALANCE,
  type ResolvedBalance,
} from "../../core/balances/chain-balance.service";
import { getNetworkDisplayName } from "../../core/networks/chain-registry";
import { TokenWithChainBadge } from "../components/TokenWithChainBadge";
import {
  CrossChainTokenPicker,
  type PickerToken,
} from "../components/CrossChainTokenPicker";
import { SwapHeader } from "../components/SwapHeader";
import { SwapRouteNotice } from "../components/SwapRouteNotice";
import "./SwapPage.css";

// Canonical network label fallback when the LI.FI chain entry hasn't loaded.
const getNetworkLabel = getNetworkDisplayName;

// Internal cross-chain swap surface. Rendered by SwapPage whenever the chosen
// destination chain differs from the source chain — it is NOT a user-facing
// "Bridge" page (the header reads "Swap"). Same-chain pairs never reach here;
// the same-chain 0x / Jupiter flows own those.
type BridgePageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  onBack: () => void;
  onBridgeCompleted?: () => void | Promise<void>;
  // Source/destination chains the parent Swap screen entered cross-chain with.
  initialFromChainId?: number;
  initialToChainId?: number;
  // Source token the parent screen entered with (e.g. the Solana FROM token when
  // a Solana → EVM bridge is launched from the Solana swap screen). Preselected
  // so the route matches the user's choice; reconciled against LI.FI's canonical
  // token list on load so native identifiers stay correct.
  initialFromToken?: {
    chainId: number;
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    isNative: boolean;
    logoUrl?: string | null;
  } | null;
  // Destination token the user picked on another network from the same-chain
  // Swap screen (preselected here so the route matches their choice).
  initialToToken?: {
    chainId: number;
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    isNative: boolean;
    logoUrl?: string | null;
  } | null;
  // Called when the user collapses the pair back to a single chain (From === To).
  // The parent returns to the same-chain Swap flow for that chain so same-chain
  // routing always uses 0x / Jupiter, never LI.FI.
  onSameChainSelected?: (chainId: number) => void;
};

type Step = "form" | "review" | "success";
type Side = "from" | "to";
type ApprovalState =
  | "unknown"
  | "checking"
  | "needed"
  | "approving"
  | "approved"
  | "notNeeded";
type SubmitStatus =
  | "idle"
  | "preparingAccount"
  | "preparing"
  | "signing"
  | "submitting"
  | "error";

const SLIPPAGE_PRESETS = [10, 50, 100] as const;
const DEFAULT_FROM_CHAIN = 8453; // Base
const DEFAULT_TO_CHAIN = 56; // BNB Chain

// MAX reserve for a native-SOL source: must cover the bridge tx fee AND a
// possible wSOL setup tx (idempotent ATA create ≈ 0.00204 SOL rent + tx fee) so
// a MAX-entered amount still leaves enough SOL to prepare + execute the route.
// ~0.0035 SOL — bigger than the plain send reserve (SOL_FEE_RESERVE_LAMPORTS),
// deliberately, because a native-SOL bridge may need wSOL wrapping.
const SOLANA_NATIVE_MAX_RESERVE_LAMPORTS = 3_500_000n;
// Lamports reserve used by the wSOL setup balance gate (setup tx fee + buffer).
const WSOL_SETUP_FEE_RESERVE_LAMPORTS = 10_000n;

// MAX reserve (sun) for a native-TRX source: TRON contract calls (a bridge is a
// TriggerSmartContract) are paid in TRX for energy/bandwidth. Keep a buffer so a
// MAX-entered amount still leaves TRX to cover the network fee. 5 TRX = 5_000_000
// sun — conservative without burning a large slice of the balance.
const TRON_NATIVE_MAX_RESERVE_SUN = 5_000_000n;

// ── Amount helpers ──────────────────────────────────────────────────────────

function decimalToBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d*(?:\.\d*)?$/u.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Enter a valid amount.");
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`Too many decimals — max ${decimals}.`);
  }
  const padded = fracPart.padEnd(decimals, "0");
  return BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function formatBaseUnits(
  raw: string | number | null | undefined,
  decimals: number,
): string {
  if (raw == null) return "—";
  let value: bigint;
  try {
    value = BigInt(typeof raw === "number" ? Math.trunc(raw) : raw);
  } catch {
    return "—";
  }
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  if (frac === 0n) return whole.toString();
  // Trim to at most 8 significant fractional places for display.
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, 8)
    .replace(/0+$/u, "");
  if (!fracStr) return whole.toString();
  return `${whole.toString()}.${fracStr}`;
}

function formatSlippage(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  return `~${Math.round(seconds / 60)} min`;
}

// approve(address spender, uint256 amount) calldata.
function encodeErc20Approve(spender: string, amountBaseUnits: string): string {
  const selector = "095ea7b3";
  const addr = spender.toLowerCase().replace(/^0x/u, "").padStart(64, "0");
  const amt = BigInt(amountBaseUnits).toString(16).padStart(64, "0");
  return `0x${selector}${addr}${amt}`;
}

// Map any failure to a short, user-facing message. NEVER returns the raw
// provider/ethers string — unknown failures collapse to a generic line so no
// JSON / calldata / revert dump / stack text can ever reach the UI.
function friendlyError(error: unknown): string {
  if (error instanceof NoBridgeRouteError) {
    return "No route found for this pair. Try another token, chain, or amount.";
  }
  // Coded Solana execution errors carry curated, display-safe messages (they
  // never embed the raw cause / key material). Surface a precise reason for each
  // so a Solana-source bridge failure is never collapsed into the generic line.
  if (error instanceof SolanaError) {
    switch (error.code) {
      case "BLOCKHASH_EXPIRED":
        return "This route expired before signing. I refreshed it — try again.";
      case "PROVIDER_STALE_TX":
        return "This route keeps expiring before it can be signed. Please try again in a moment.";
      case "WRONG_SIGNER":
        return "This route needs a different Solana signer than your active account.";
      // ── Route-level (the tx is valid; the route failed on-chain) ──
      case "SOLANA_ROUTE_SIMULATION_FAILED":
        return "The bridge route failed Solana simulation. Try a fresh quote, another amount, or another route.";
      case "SOLANA_PROGRAM_ERROR":
      case "PROGRAM_ERROR":
        return "The Mayan bridge program rejected this route during simulation.";
      case "SOLANA_ACCOUNT_ERROR":
        return "The bridge route references an invalid Solana account.";
      case "SOLANA_TOKEN_ACCOUNT_ERROR":
        return "The bridge route references an invalid Solana token account.";
      case "SOLANA_BRIDGE_PROGRAM_ACCOUNT_ERROR":
        return "The Mayan bridge program rejected one of the route accounts.";
      // ── wSOL setup tx (native SOL → wSOL preparation) ──
      case "WSOL_SETUP_SIMULATION_FAILED":
        return "Could not prepare the wrapped SOL account.";
      case "WSOL_SETUP_SEND_FAILED":
        return "Could not send the wrapped SOL setup transaction.";
      case "WSOL_SETUP_CONFIRM_FAILED":
        return "Wrapped SOL setup was submitted but confirmation timed out. Check the transaction before trying again.";
      case "WSOL_SETUP_INSUFFICIENT_SOL":
        return "Not enough SOL to prepare the wrapped SOL account and pay network fees.";
      case "WSOL_SETUP_BLOCKHASH_EXPIRED":
        return "The wrapped SOL setup expired before it landed. Try again.";
      case "WSOL_SETUP_RPC_UNAVAILABLE":
        return "Solana RPC is temporarily unavailable. Please try again.";
      case "ALT_LOOKUP_FAILED":
        return "An address lookup table required by this route is unavailable.";
      case "SIMULATION_FAILED":
        return "The bridge route failed Solana simulation. Try a fresh quote, another amount, or another route.";
      // ── Genuinely unsupported tx format (decode/deserialize failed) ──
      case "UNSUPPORTED_SOLANA_TX_FORMAT":
      case "INVALID_ROUTE_TX":
        return "The bridge provider returned a Solana transaction format Simpl cannot execute yet.";
      case "INSUFFICIENT_SOL_FOR_FEE":
        return "Not enough SOL left for network fees. Lower the amount or add SOL.";
      case "INSUFFICIENT_BALANCE":
        return "Insufficient SOL for this amount plus the network fee.";
      case "BUILD_TX_FAILED":
        return "The bridge returned a transaction we couldn't read. Get a fresh quote and try again.";
      case "SIGNING_FAILED":
        return "Could not sign the bridge transaction.";
      case "BROADCAST_FAILED":
        return "Solana rejected the transaction on broadcast. Get a fresh quote and try again.";
      case "SOLANA_NETWORK_ERROR":
        return "Solana RPC is temporarily unavailable. Please try again.";
      case "WATCH_ONLY":
        return "Watch-only accounts cannot swap.";
      default:
        return error.message;
    }
  }
  // Coded TRON execution errors carry curated, display-safe messages.
  if (error instanceof TronError) {
    switch (error.code) {
      case "INSUFFICIENT_TRX_BALANCE":
        return "Not enough TRX for network fees.";
      case "INSUFFICIENT_TOKEN_BALANCE":
        return "Insufficient balance for this TRON route.";
      case "INVALID_TRON_ADDRESS":
        return "TRON destination address is missing or invalid.";
      case "TRON_BUILD_TX_FAILED":
        return "TRON transaction format is not supported yet.";
      case "TRON_SIGN_REJECTED":
        return "TRON transaction rejected.";
      case "TRON_SIGN_FAILED":
        return "Could not sign the TRON transaction.";
      case "TRON_BROADCAST_FAILED":
        return "Failed to broadcast the TRON transaction. Try again.";
      case "TRON_NETWORK_ERROR":
        return "TRON network is temporarily unavailable. Please try again.";
      case "TRON_TX_FAILED":
        return "The TRON transaction failed. Get a fresh quote and try again.";
      default:
        return error.message;
    }
  }
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lower = message.toLowerCase();

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("4001") ||
    lower.includes("rejected")
  ) {
    return "Transaction rejected in wallet.";
  }
  // Approval too low for the requested amount (checked before generic allowance).
  if (
    lower.includes("exceeds allowance") ||
    lower.includes("insufficient allowance") ||
    (lower.includes("allowance") && lower.includes("amount"))
  ) {
    return "Approval is too low for this amount. Approve again and retry.";
  }
  if (
    lower.includes("allowance") ||
    lower.includes("approval") ||
    lower.includes("approve")
  ) {
    return "Approve token first, then try again.";
  }
  if (
    lower.includes("insufficient") ||
    lower.includes("not enough") ||
    lower.includes("exceeds balance")
  ) {
    return "Insufficient balance.";
  }
  if (
    lower.includes("expired") ||
    lower.includes("quote is no longer") ||
    lower.includes("stale")
  ) {
    return "This route expired. Get a fresh quote and try again.";
  }
  if (
    lower.includes("simulation failed") ||
    lower.includes("simulate") ||
    lower.includes("blockhash") ||
    lower.includes("reverted")
  ) {
    return "Transaction simulation failed. Try a fresh quote or a smaller amount.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network error") ||
    lower.includes("timeout") ||
    lower.includes("aborted") ||
    lower.includes("rpc")
  ) {
    return "Network or RPC is temporarily unavailable. Please try again.";
  }
  if (lower.includes("no route") || lower.includes("not found")) {
    return "No route found for this pair. Try another token, chain, or amount.";
  }
  if (lower.includes("different chain") || lower.includes("wrong chain")) {
    return "This route is for a different network. Get a fresh quote and try again.";
  }
  // Unknown provider failure — generic only, never the raw message.
  return "Could not prepare this route. Try again.";
}

// friendlyError + an OPT-IN dev detail for Solana simulation/account/program
// failures: "(dev: instruction #N failed with <reason> in <program>.)". Only
// appended when bridge debug is enabled — production users see the clean message.
function describeBridgeError(error: unknown): string {
  const base = friendlyError(error);
  if (!isBridgeDebugEnabled() || !(error instanceof SolanaError)) return base;
  const routeCodes = new Set<string>([
    "SOLANA_ACCOUNT_ERROR",
    "SOLANA_TOKEN_ACCOUNT_ERROR",
    "SOLANA_BRIDGE_PROGRAM_ACCOUNT_ERROR",
    "SOLANA_PROGRAM_ERROR",
    "PROGRAM_ERROR",
    "SOLANA_ROUTE_SIMULATION_FAILED",
    "SIMULATION_FAILED",
  ]);
  if (!routeCodes.has(error.code)) return base;
  const f = getLastSolanaInstructionFailure();
  if (!f) return base;
  const where =
    f.programLabel && f.programLabel !== "unknown" ? ` in ${f.programLabel}` : "";
  return `${base} (dev: instruction #${f.instructionIndex} failed with ${f.reason}${where}.)`;
}

// Balance row copy following the no-fake-zero rules: loading → "loading…",
// loaded → the real value, anything else (unavailable / error) → "—".
function balanceLabel(
  balance: ResolvedBalance,
  symbol: string | undefined,
): string {
  if (balance.status === "loading") return "Balance: loading…";
  if (balance.status === "loaded") {
    return `Balance: ${balance.formatted}${symbol ? ` ${symbol}` : ""}`;
  }
  // "error" = the read failed across every RPC endpoint (retryable);
  // "unavailable" = no address/token to read yet.
  if (balance.status === "error") return "Balance unavailable";
  return "Balance: —";
}

// Prefer a stablecoin, then native, then the first token as the default pick.
function pickDefaultToken(list: BridgeToken[]): BridgeToken | null {
  const stable = list.find((t) =>
    ["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase()),
  );
  if (stable) return stable;
  return list.find((t) => t.isNative) ?? list[0] ?? null;
}

// LI.FI's canonical Solana token for native SOL is the wSOL mint, often labelled
// "wSOL" — but the user pays native SOL from their Solana wallet. Detect that
// source token so we can DISPLAY it as "SOL" and read the native SOL balance,
// while the quote keeps using whatever LI.FI identifier the token carries.
function isSolanaNativeSource(
  chainId: number,
  token: BridgeToken | null,
): boolean {
  if (chainId !== LIFI_SOLANA_CHAIN_ID || !token) return false;
  const symbol = token.symbol.toUpperCase();
  return (
    token.isNative ||
    token.address.toLowerCase() === SOL_WSOL_MINT.toLowerCase() ||
    symbol === "SOL" ||
    symbol === "WSOL"
  );
}

// True when the source is native TRX on the TRON chain — used to keep a TRX fee
// reserve on MAX and to read native TRX decimals (6), never the EVM 18.
function isTronNativeSource(
  chainId: number,
  token: BridgeToken | null,
): boolean {
  return chainId === LIFI_TRON_CHAIN_ID && Boolean(token?.isNative);
}

// True when the destination chain is TRON (by LI.FI chainType or chain id).
function isTronDestination(
  chain: BridgeChain | undefined,
  chainId: number,
): boolean {
  return (
    chainId === LIFI_TRON_CHAIN_ID ||
    (chain?.chainType?.toUpperCase() === "TVM")
  );
}

// Resolve a Solana source-token balance using the Solana RPC (never the EVM
// loaders): native SOL via getSolBalance, SPL via getSplTokenBalanceByMint. A
// missing SPL token account is a real zero, not a permanent dash.
async function resolveSolanaSourceBalance(params: {
  owner: string | null;
  chainId: number;
  token: BridgeToken;
}): Promise<ResolvedBalance> {
  if (!params.owner) return UNAVAILABLE_BALANCE;
  try {
    if (isSolanaNativeSource(params.chainId, params.token)) {
      const balance = await getSolBalance(params.owner, SOLANA_MAINNET);
      return {
        status: "loaded",
        baseUnits: balance.raw.toString(),
        formatted: balance.formatted,
      };
    }
    const balance = await getSplTokenBalanceByMint(
      SOLANA_MAINNET,
      params.owner,
      params.token.address,
    );
    if (!balance) {
      return { status: "loaded", baseUnits: "0", formatted: "0" };
    }
    return {
      status: "loaded",
      baseUnits: balance.rawAmount.toString(),
      formatted: balance.uiAmountString,
    };
  } catch {
    return { status: "error", baseUnits: null, formatted: null };
  }
}

// Resolve a TRON source-token balance via the TRON adapter (TronGrid), never the
// EVM loaders: native TRX via getTrxBalance (sun, 6 decimals), TRC-20 via
// getTrc20Balance. A failed read is surfaced as a retryable "error", not "0".
async function resolveTronSourceBalance(params: {
  owner: string | null;
  token: BridgeToken;
}): Promise<ResolvedBalance> {
  if (!params.owner) return UNAVAILABLE_BALANCE;
  try {
    if (params.token.isNative) {
      const sun = await getTrxBalance(params.owner);
      return {
        status: "loaded",
        baseUnits: sun.toString(),
        formatted: tronFromBaseUnits(sun, params.token.decimals),
      };
    }
    const base = await getTrc20Balance(
      params.owner,
      params.token.address,
      params.token.decimals,
    );
    return {
      status: "loaded",
      baseUnits: base.toString(),
      formatted: tronFromBaseUnits(base, params.token.decimals),
    };
  } catch {
    return { status: "error", baseUnits: null, formatted: null };
  }
}

export function BridgePage({
  selectedAccount,
  walletState,
  onBack,
  onBridgeCompleted,
  initialFromChainId,
  initialToChainId,
  initialFromToken,
  initialToToken,
  onSameChainSelected,
}: BridgePageProps) {
  const isWatchOnly = selectedAccount?.type === "watch";
  // Prefer the source chain the parent Swap screen entered with; otherwise the
  // wallet's active network when it's a signable EVM chain, otherwise Base.
  const initialFromChain =
    initialFromChainId ??
    (isSignableSourceChain(walletState.selectedChainId)
      ? walletState.selectedChainId
      : DEFAULT_FROM_CHAIN);
  const evmAddress = selectedAccount?.address ?? null;
  const solanaAddress =
    selectedAccount && "solanaAddress" in selectedAccount
      ? selectedAccount.solanaAddress ?? null
      : null;
  const tronAddress =
    selectedAccount && "tronAddress" in selectedAccount
      ? selectedAccount.tronAddress ?? null
      : null;

  const [chains, setChains] = useState<BridgeChain[]>([]);
  const [chainsError, setChainsError] = useState<string | null>(null);

  const [fromChainId, setFromChainId] = useState<number>(initialFromChain);
  const [toChainId, setToChainId] = useState<number>(() => {
    if (initialToChainId != null && initialToChainId !== initialFromChain) {
      return initialToChainId;
    }
    return initialFromChain === DEFAULT_TO_CHAIN
      ? DEFAULT_FROM_CHAIN
      : DEFAULT_TO_CHAIN;
  });

  const [fromTokens, setFromTokens] = useState<BridgeToken[]>([]);
  const [toTokens, setToTokens] = useState<BridgeToken[]>([]);
  const [fromToken, setFromToken] = useState<BridgeToken | null>(() =>
    initialFromToken && initialFromToken.chainId === initialFromChain
      ? { ...initialFromToken, logoUrl: initialFromToken.logoUrl ?? null, priceUsd: null }
      : null,
  );
  const [toToken, setToToken] = useState<BridgeToken | null>(() =>
    initialToToken && initialToToken.chainId === initialToChainId
      ? { ...initialToToken, logoUrl: initialToToken.logoUrl ?? null, priceUsd: null }
      : null,
  );

  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  // Which side's cross-chain token picker is open (token selection also drives
  // that side's chain — chain follows token).
  const [tokenPicker, setTokenPicker] = useState<Side | null>(null);

  const [step, setStep] = useState<Step>("form");
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [approvalState, setApprovalState] = useState<ApprovalState>("unknown");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  // Source-chain wSOL setup tx signature (native-SOL Solana routes), tracked in a
  // ref so finalizeBridgeSuccess reads the just-set value within the same handler
  // (state would be stale until the next render). Recorded in history alongside —
  // never as — the main bridge tx.
  const wsolSetupSigRef = useRef<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [bridgeProgress, setBridgeProgress] = useState<
    "pending" | "confirmed" | "failed"
  >("pending");

  const fromChain = useMemo(
    () => chains.find((c) => c.id === fromChainId),
    [chains, fromChainId],
  );
  const toChain = useMemo(
    () => chains.find((c) => c.id === toChainId),
    [chains, toChainId],
  );

  // The signing address for a given chain depends on its family.
  function addressForChain(chain: BridgeChain | undefined): string | null {
    if (!chain) return evmAddress;
    const type = chain.chainType.toUpperCase();
    if (type === "EVM") return evmAddress;
    if (type === "SVM") return solanaAddress;
    if (type === "TVM" || chain.key === "tron") return tronAddress;
    return evmAddress;
  }

  // Chain-aware balances for the selected From / To tokens. These carry an
  // explicit state (loading / loaded / unavailable / error) so the UI never
  // shows a fabricated "0" for a balance that wasn't actually read.
  const [fromBalance, setFromBalance] =
    useState<ResolvedBalance>(UNAVAILABLE_BALANCE);
  const [toBalance, setToBalance] =
    useState<ResolvedBalance>(UNAVAILABLE_BALANCE);
  // Bumped to force a fresh From-balance read (manual retry after an RPC error).
  const [balanceReloadKey, setBalanceReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const owner = addressForChain(fromChain);
    if (!fromToken) {
      setFromBalance(UNAVAILABLE_BALANCE);
      return;
    }
    setFromBalance(LOADING_BALANCE);
    // Solana / TRON source → read the real balance off that chain's RPC with the
    // account's chain-specific address; never the EVM loaders.
    const resolver =
      fromChainId === LIFI_SOLANA_CHAIN_ID
        ? resolveSolanaSourceBalance({ owner, chainId: fromChainId, token: fromToken })
        : fromChainId === LIFI_TRON_CHAIN_ID
          ? resolveTronSourceBalance({ owner, token: fromToken })
          : resolveChainTokenBalance({
            owner,
            chainId: fromChainId,
            tokenAddress: fromToken.isNative ? null : fromToken.address,
            isNative: fromToken.isNative,
            decimals: fromToken.decimals,
          });
    void resolver.then((r) => {
      if (active) setFromBalance(r);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken, fromChainId, evmAddress, solanaAddress, tronAddress, balanceReloadKey]);

  useEffect(() => {
    let active = true;
    const owner = addressForChain(toChain);
    if (!toToken) {
      setToBalance(UNAVAILABLE_BALANCE);
      return;
    }
    setToBalance(LOADING_BALANCE);
    void resolveChainTokenBalance({
      owner,
      chainId: toChainId,
      tokenAddress: toToken.isNative ? null : toToken.address,
      isNative: toToken.isNative,
      decimals: toToken.decimals,
    }).then((r) => {
      if (active) setToBalance(r);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toToken, toChainId, evmAddress, solanaAddress, tronAddress]);

  // If the user collapses the pair onto a single chain, hand control back to the
  // same-chain Swap flow (0x / Jupiter) — LI.FI is never used for same-chain.
  useEffect(() => {
    if (onSameChainSelected && fromChainId === toChainId) {
      onSameChainSelected(fromChainId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChainId, toChainId]);

  // ── Load chains once ──
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await getBridgeChains();
        if (!active) return;
        setChains(list);
        setChainsError(null);
        // Fall back to sensible defaults if our preferred chains aren't offered.
        if (!list.some((c) => c.id === DEFAULT_FROM_CHAIN)) {
          const firstSignable = list.find((c) => c.signable) ?? list[0];
          if (firstSignable) setFromChainId(firstSignable.id);
        }
        if (!list.some((c) => c.id === DEFAULT_TO_CHAIN)) {
          const firstDifferent = list.find((c) => c.id !== fromChainId);
          if (firstDifferent) setToChainId(firstDifferent.id);
        }
      } catch (e) {
        if (!active) return;
        setChainsError(friendlyError(e));
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load tokens whenever a chain changes ──
  useEffect(() => {
    let active = true;
    setFromTokens([]);
    // Preserve an explicitly-picked token that already matches the new chain
    // (cross-network pick sets chain + token together); otherwise clear.
    setFromToken((cur) => (cur && cur.chainId === fromChainId ? cur : null));
    void (async () => {
      try {
        const list = await getBridgeTokens(fromChainId);
        if (!active) return;
        setFromTokens(list);
        setFromToken((cur) => {
          if (!cur) return pickDefaultToken(list);
          // Solana source only: reconcile a handed-off token (e.g. native SOL
          // from the Solana swap screen) against LI.FI's canonical list so the
          // quote uses LI.FI's exact token identifier. Match by address, then by
          // symbol. The EVM From flow keeps its existing keep-as-picked behavior.
          if (fromChainId === LIFI_SOLANA_CHAIN_ID) {
            const byAddress = list.find(
              (t) => t.address.toLowerCase() === cur.address.toLowerCase(),
            );
            if (byAddress) return byAddress;
            const bySymbol = list.find(
              (t) => t.symbol.toUpperCase() === cur.symbol.toUpperCase(),
            );
            if (bySymbol) return bySymbol;
          }
          return cur;
        });
      } catch {
        if (active) setFromTokens([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [fromChainId]);

  useEffect(() => {
    let active = true;
    setToTokens([]);
    setToToken((cur) => (cur && cur.chainId === toChainId ? cur : null));
    void (async () => {
      try {
        const list = await getBridgeTokens(toChainId);
        if (!active) return;
        setToTokens(list);
        setToToken((cur) => cur ?? pickDefaultToken(list));
      } catch {
        if (active) setToTokens([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [toChainId]);

  // Any input change invalidates a prepared quote.
  function resetQuote() {
    setQuote(null);
    setError(null);
    setApprovalState("unknown");
    setSubmitStatus("idle");
    if (step === "review") setStep("form");
  }

  // A picked token carries its chain — set the chain and the token together so a
  // cross-network pick automatically reshapes the route (different chains → a
  // cross-chain LI.FI route; same chain on both sides hands back to same-chain).
  function pickerToBridgeToken(p: PickerToken): BridgeToken {
    return {
      chainId: p.chainId,
      address: p.address,
      symbol: p.symbol,
      name: p.name,
      decimals: p.decimals,
      logoUrl: p.logoUrl ?? null,
      priceUsd: null,
      isNative: p.isNative,
    };
  }

  function handlePickToken(p: PickerToken) {
    const token = pickerToBridgeToken(p);
    if (tokenPicker === "from") {
      if (p.chainId !== fromChainId) setFromChainId(p.chainId);
      setFromToken(token);
      setAmount("");
    } else {
      if (p.chainId !== toChainId) setToChainId(p.chainId);
      setToToken(token);
    }
    setTokenPicker(null);
    resetQuote();
  }

  // Whether the From balance is loaded and positive (gates MAX).
  const fromBalancePositive =
    fromBalance.status === "loaded" &&
    fromBalance.baseUnits != null &&
    fromBalance.baseUnits !== "0";

  const validation = useMemo<string | null>(() => {
    if (isWatchOnly) return "Watch-only accounts cannot swap.";
    if (!fromToken || !toToken) return "Select tokens to swap.";
    if (!addressForChain(fromChain)) {
      return "This account has no address for the source chain.";
    }
    if (
      fromChainId === toChainId &&
      fromToken.address.toLowerCase() === toToken.address.toLowerCase()
    ) {
      return "Choose a different destination token or chain.";
    }
    if (!amount.trim() || Number(amount) <= 0) return "Enter amount";
    let amountBase: bigint;
    try {
      amountBase = decimalToBaseUnits(amount, fromToken.decimals);
    } catch (e) {
      return e instanceof Error ? e.message : "Enter a valid amount.";
    }
    if (amountBase <= 0n) return "Enter amount";

    // Balance-aware gating — never blocks on a fake / unknown balance.
    //  • loading  → wait ("Loading balance")
    //  • loaded   → block only on a real shortfall ("Insufficient {symbol}")
    //  • else     → allow the quote (no fake balance, no block)
    if (fromBalance.status === "loading") return "Loading balance";
    if (fromBalance.status === "loaded" && fromBalance.baseUnits != null) {
      try {
        const balanceBase = BigInt(fromBalance.baseUnits);
        if (amountBase > balanceBase) {
          const sym = isSolanaNativeSource(fromChainId, fromToken)
            ? "SOL"
            : fromToken.symbol;
          return `Insufficient ${sym}`;
        }
        // Native SOL source: keep a small lamport reserve for the network fee —
        // bridging the entire balance would leave nothing to pay for the tx.
        if (
          isSolanaNativeSource(fromChainId, fromToken) &&
          amountBase + SOL_FEE_RESERVE_LAMPORTS > balanceBase
        ) {
          return "Keep some SOL for network fees";
        }
        // Native TRX source: keep a TRX reserve for the energy/bandwidth fee.
        if (
          isTronNativeSource(fromChainId, fromToken) &&
          amountBase + TRON_NATIVE_MAX_RESERVE_SUN > balanceBase
        ) {
          return "Not enough TRX for network fees.";
        }
      } catch {
        // ignore — fall through to allow
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isWatchOnly,
    fromToken,
    toToken,
    fromChain,
    fromChainId,
    toChainId,
    amount,
    fromBalance,
    evmAddress,
    solanaAddress,
    tronAddress,
  ]);

  // Set the From amount to the full loaded balance (only available when loaded).
  function handleMax() {
    if (
      fromBalance.status !== "loaded" ||
      fromBalance.baseUnits == null ||
      fromBalance.baseUnits === "0" ||
      !fromToken
    ) {
      return;
    }
    let maxBase = BigInt(fromBalance.baseUnits);
    // Native SOL source: leave a reserve covering bridge fee + a possible wSOL
    // setup (rent + tx fee). If the reserve exceeds the balance, MAX is a no-op
    // (validation will already show "Keep some SOL for network fees").
    if (isSolanaNativeSource(fromChainId, fromToken)) {
      if (maxBase <= SOLANA_NATIVE_MAX_RESERVE_LAMPORTS) return;
      maxBase = maxBase - SOLANA_NATIVE_MAX_RESERVE_LAMPORTS;
    }
    // Native TRX source: subtract a TRX reserve so MAX still leaves fee headroom.
    // A TRC-20 MAX uses the full token balance but still needs TRX for fees (a
    // separate balance, gated at execution with a clear message).
    if (isTronNativeSource(fromChainId, fromToken)) {
      if (maxBase <= TRON_NATIVE_MAX_RESERVE_SUN) return;
      maxBase = maxBase - TRON_NATIVE_MAX_RESERVE_SUN;
    }
    setAmount(formatBaseUnits(maxBase.toString(), fromToken.decimals));
    resetQuote();
  }

  async function handleGetQuote() {
    if (validation || !fromToken || !toToken) {
      setError(validation);
      return;
    }
    const fromAddress = addressForChain(fromChain);
    if (!fromAddress) {
      setError("This account has no address for the source chain.");
      return;
    }
    // Destination address MUST match the destination chain's family — never send
    // an EVM address as a Solana recipient (or vice-versa). No cross-type
    // fallback: if the account has no address for the destination chain, stop.
    const toAddress = addressForChain(toChain);
    if (!toAddress) {
      setError("This account has no address for the destination chain.");
      return;
    }
    // TRON destination must be a valid base58 T… address — never an EVM 0x or a
    // Solana pubkey. The source still signs on its own chain (EVM/Solana/TRON).
    if (isTronDestination(toChain, toChainId) && !isValidTronAddress(toAddress)) {
      setError("TRON destination address is missing or invalid.");
      return;
    }

    setError(null);
    setReviewLoading(true);
    try {
      const amountBase = decimalToBaseUnits(amount, fromToken.decimals);

      // Insufficient-balance is already gated by `validation` against the real
      // loaded balance (never a fake zero), so no extra balance read here.

      const nextQuote = await getBridgeQuote({
        fromChainId,
        toChainId,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
        fromAmountBaseUnits: amountBase.toString(),
        fromAddress,
        toAddress,
        slippageBps,
      });

      setQuote(nextQuote);
      setStep("review");

      // Diagnostics — selected pair, address TYPES (never raw addresses) and the
      // resolved execution readiness. `ctaEnabled` mirrors the Confirm gating.
      bridgeDebugLog("page:quote", {
        fromChain: fromChainId,
        toChain: toChainId,
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        fromAddressType: classifyAddressType(fromAddress),
        toAddressType: classifyAddressType(toAddress),
        sourceChainType: nextQuote.sourceChainType,
        destinationChainType: nextQuote.destinationChainType,
        executionStatus: nextQuote.executionStatus,
        txFormat: nextQuote.txFormat,
        ctaEnabled: nextQuote.executable,
      });

      // Determine whether an ERC-20 approval is required for executable EVM
      // routes. Solana routes never need an EVM allowance.
      if (
        nextQuote.executable &&
        nextQuote.txFormat === "evm" &&
        !fromToken.isNative &&
        nextQuote.approvalAddress
      ) {
        setApprovalState("checking");
        const allowance = await readErc20Allowance({
          chainId: fromChainId,
          tokenAddress: fromToken.address,
          owner: fromAddress,
          spender: nextQuote.approvalAddress,
        });
        setApprovalState(
          allowance != null && allowance >= amountBase ? "notNeeded" : "needed",
        );
      } else if (
        nextQuote.executable &&
        nextQuote.txFormat === "tron" &&
        !fromToken.isNative &&
        nextQuote.approvalAddress
      ) {
        // TRON-source TRC-20: check the live TRC-20 allowance (never EVM code).
        setApprovalState("checking");
        const allowance = await readTrc20Allowance({
          owner: fromAddress,
          contractAddress: fromToken.address,
          spender: nextQuote.approvalAddress,
        });
        setApprovalState(
          allowance != null && allowance >= amountBase ? "notNeeded" : "needed",
        );
      } else {
        setApprovalState("notNeeded");
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleApprove() {
    if (!quote?.approvalAddress || !fromToken) return;
    setError(null);
    setApprovalState("approving");
    try {
      const amountBase = decimalToBaseUnits(amount, fromToken.decimals);
      // TRON-source TRC-20 approval goes through the TRON adapter (build → sign →
      // broadcast → confirm); never the EVM approve calldata path.
      if (quote.txFormat === "tron") {
        await walletService.executeSelectedTronBridgeApproval({
          contractAddress: fromToken.address,
          spender: quote.approvalAddress,
          amountBaseUnits: amountBase.toString(),
        });
        setApprovalState("approved");
        return;
      }
      const data = encodeErc20Approve(
        quote.approvalAddress,
        amountBase.toString(),
      );
      await walletService.sendPreparedTransactionForChain({
        transaction: { to: fromToken.address, data, value: "0" },
        chainId: fromChainId,
        waitForReceipt: true,
      });
      setApprovalState("approved");
    } catch (e) {
      setApprovalState("needed");
      setError(friendlyError(e));
    }
  }

  // Refresh + validate an executable route immediately before signing, so the
  // wallet never broadcasts a stale transaction (an expired Solana blockhash, or
  // EVM calldata that aged out while the user reviewed). Returns the FRESH quote
  // to sign, or null when we shouldn't sign (the UI has already been updated with
  // the reason / new amount).
  async function refreshBeforeSign(): Promise<BridgeQuote | null> {
    if (!quote || !fromToken || !toToken) return null;
    const fromAddress = addressForChain(fromChain);
    const toAddress = addressForChain(toChain);
    if (!fromAddress) {
      setSubmitStatus("error");
      setError("This account has no address for the source chain.");
      return null;
    }
    if (!toAddress) {
      setSubmitStatus("error");
      setError("This account has no address for the destination chain.");
      return null;
    }
    if (isTronDestination(toChain, toChainId) && !isValidTronAddress(toAddress)) {
      setSubmitStatus("error");
      setError("TRON destination address is missing or invalid.");
      return null;
    }

    const amountBase = decimalToBaseUnits(amount, fromToken.decimals);
    const result = await prepareBridgeTransaction({
      fromChainId,
      toChainId,
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      fromAmountBaseUnits: amountBase.toString(),
      fromAddress,
      toAddress,
      slippageBps,
      previousToAmountBaseUnits: quote.toAmountBaseUnits,
      previousToAmountMinBaseUnits: quote.toAmountMinBaseUnits,
    });

    bridgeDebugLog("page:prepare", {
      fromChain: fromChainId,
      toChain: toChainId,
      ok: result.ok,
      code: result.ok ? "executable" : result.code,
    });

    if (result.ok) {
      // Adopt the fresh quote so the review numbers + status match what we sign.
      setQuote(result.quote);
      return result.quote;
    }

    // Not signable right now — surface the reason and update the visible quote.
    if (result.code === "quoteOnly" || result.code === "unsupported") {
      setQuote(result.quote);
      setSubmitStatus("idle");
      setError(null);
      return null;
    }
    if (result.code === "materialChange") {
      // Show the updated amount/min-received and require an explicit re-confirm —
      // never silently sign a quote the user didn't review.
      setQuote(result.quote);
      setApprovalState((s) => (s === "approved" ? s : "unknown"));
      setSubmitStatus("idle");
      setError(result.message);
      return null;
    }
    // noRoute / failed
    setSubmitStatus("error");
    setError(result.message);
    return null;
  }

  // Sign + broadcast a freshly-prepared route. Throws a coded error on failure
  // so the caller can classify it (and auto-refresh on a stale Solana blockhash).
  async function executeBridgeTx(active: BridgeQuote): Promise<{
    resultHash: string;
    resultExplorerUrl: string | null;
    historyFromAddress: string;
    historyToAddress: string;
  }> {
    if (active.txFormat === "solana") {
      // Solana-source execution gate: format solana + serialized data + a Solana
      // signer + the LI.FI Solana source chain.
      if (
        !active.solanaTransactionData ||
        fromChainId !== LIFI_SOLANA_CHAIN_ID ||
        !solanaAddress
      ) {
        throw new Error("Route found, execution coming soon in Simpl.");
      }
      const solResult =
        await walletService.executeSelectedSolanaBridgeTransaction({
          transactionBase64: active.solanaTransactionData,
        });
      return {
        resultHash: solResult.signature,
        resultExplorerUrl: getSolanaTransactionExplorerUrl(
          SOLANA_MAINNET,
          solResult.signature,
        ),
        historyFromAddress: solResult.address,
        historyToAddress: solResult.address,
      };
    }
    if (active.txFormat === "tron") {
      // TRON-source execution gate: format tron + an extracted raw_data_hex + a
      // TRON signer + the LI.FI TRON source chain.
      if (
        !active.tronTransactionData ||
        fromChainId !== LIFI_TRON_CHAIN_ID ||
        !tronAddress
      ) {
        throw new Error("Route found, execution coming soon in Simpl.");
      }
      const tronResult = await walletService.executeSelectedTronBridgeTransaction({
        rawDataHex: active.tronTransactionData,
        quoteFromAddress: active.tronFromAddress,
      });
      return {
        resultHash: tronResult.txId,
        resultExplorerUrl: tronResult.explorerUrl,
        historyFromAddress: tronResult.address,
        historyToAddress: addressForChain(toChain) ?? tronResult.address,
      };
    }
    // EVM source.
    if (!active.transactionRequest) {
      throw new Error("The bridge returned no transaction to sign.");
    }
    // Never broadcast a route's tx to a different chain than its source — the
    // prepared calldata is only valid on the chain it was built for.
    if (active.transactionRequest.chainId !== fromChainId) {
      throw new Error("Route transaction is for a different chain.");
    }
    const result = await walletService.sendPreparedTransactionForChain({
      transaction: {
        to: active.transactionRequest.to,
        data: active.transactionRequest.data,
        value: active.transactionRequest.value,
      },
      chainId: fromChainId,
    });
    return {
      resultHash: result.hash,
      resultExplorerUrl: result.explorerUrl,
      historyFromAddress: evmAddress ?? "",
      historyToAddress: active.transactionRequest.to,
    };
  }

  // Record the submitted bridge in history and move to the success screen.
  function finalizeBridgeSuccess(
    active: BridgeQuote,
    exec: {
      resultHash: string;
      resultExplorerUrl: string | null;
      historyFromAddress: string;
      historyToAddress: string;
    },
  ): void {
    if (!fromToken || !toToken) return;
    const estReceive = formatBaseUnits(
      active.toAmountBaseUnits,
      active.toTokenDecimals,
    );
    const feeDisplay =
      active.feeCostBaseUnits && active.feeCostSymbol
        ? `${formatBaseUnits(active.feeCostBaseUnits, active.feeCostDecimals)} ${active.feeCostSymbol}`
        : undefined;
    // Record native SOL as "SOL" in activity, not LI.FI's wSOL label.
    const fromSym = isSolanaNativeSource(fromChainId, fromToken)
      ? "SOL"
      : fromToken.symbol;

    try {
      transactionHistoryService.addTransaction({
        hash: exec.resultHash,
        chainId: fromChainId,
        chainName: fromChain?.name ?? `Chain ${fromChainId}`,
        direction: "bridge",
        status: "submitted",
        assetType: "bridge",
        assetSymbol: `${fromSym} → ${toToken.symbol}`,
        assetName: `Cross-chain swap ${fromSym} to ${toChain?.name ?? "destination"}`,
        contractAddress: null,
        amount: `${amount} ${fromSym}`,
        fromAddress: exec.historyFromAddress,
        toAddress: exec.historyToAddress,
        explorerUrl: exec.resultExplorerUrl,
        createdAt: new Date().toISOString(),
        bridgeFromChainId: fromChainId,
        bridgeToChainId: toChainId,
        bridgeFromChainName: fromChain?.name,
        bridgeToChainName: toChain?.name,
        bridgeFromSymbol: fromSym,
        bridgeFromAmount: amount,
        bridgeToSymbol: toToken.symbol,
        bridgeToAmount: estReceive,
        bridgeProvider: active.toolName,
        ...(feeDisplay ? { bridgeFee: feeDisplay } : {}),
        ...(wsolSetupSigRef.current
          ? { bridgeSetupTxHash: wsolSetupSigRef.current }
          : {}),
      });
    } catch {
      // History is best-effort — never block a successful swap on it.
    }

    bridgeDebugLog("page:submitted", {
      fromChain: fromChainId,
      toChain: toChainId,
      txFormat: active.txFormat,
      // The on-chain tx hash / Solana signature is a public identifier — safe to
      // log (it is not a secret), and the explorer link uses it anyway.
      txHash: exec.resultHash,
    });

    setTxHash(exec.resultHash);
    setExplorerUrl(exec.resultExplorerUrl);
    setBridgeProgress("pending");
    setSubmitStatus("idle");
    setStep("success");
    void onBridgeCompleted?.();
  }

  // Force the current quote to a non-executable state. Used when execution
  // rejects a Solana payload the quote gating had accepted (an invariant
  // violation) — the UI must never keep showing "Execution supported" for a tx
  // we can't actually run. This flips the status row and disables Confirm.
  function degradeQuoteToUnsupported(active: BridgeQuote, reason: string): void {
    setQuote({
      ...active,
      executable: false,
      executionStatus: "unsupported",
      executionReason: reason,
      solanaTransactionData: null,
      solanaTransactionFormat: null,
      solanaTransactionSourceField: null,
      solanaTransactionByteLength: null,
    });
  }

  // Degrade ONLY for a genuinely unsupported tx format (extraction succeeded at
  // gating but execution couldn't deserialize it — an invariant violation). A
  // simulation/program/account failure is NOT a format problem and must NOT
  // degrade an executable route. Returns true when it handled the error.
  function degradeOnUnsupportedFormat(
    active: BridgeQuote,
    error: unknown,
  ): boolean {
    if (
      !(error instanceof SolanaError) ||
      error.code !== "UNSUPPORTED_SOLANA_TX_FORMAT"
    ) {
      return false;
    }
    logSolanaInvariantAfterGating({
      sourceField: active.solanaTransactionSourceField,
      byteLength: active.solanaTransactionByteLength,
      format: active.solanaTransactionFormat,
      executionStatus: active.executionStatus,
      code: error.code,
    });
    degradeQuoteToUnsupported(
      active,
      "Provider returned a Solana transaction format Simpl cannot execute yet.",
    );
    setSubmitStatus("idle");
    setError(
      "The bridge provider returned a Solana transaction format Simpl cannot execute yet.",
    );
    return true;
  }

  // Native-SOL routes only: if the provider tx expects a funded wSOL ATA that
  // doesn't exist for this wallet, send a SEPARATE setup tx (idempotent ATA →
  // wrap lamports → SyncNative), then refresh the quote and return the fresh
  // executable route. Returns the (possibly refreshed) quote to sign, or null
  // when we've set an error/preview state and must abort. Never mutates the
  // provider tx; only fires for the wallet's exact expected wSOL ATA.
  async function maybePrepareWsolAndRefresh(
    active: BridgeQuote,
  ): Promise<BridgeQuote | null> {
    if (
      active.txFormat !== "solana" ||
      !fromToken ||
      !isSolanaNativeSource(fromChainId, fromToken) ||
      !solanaAddress ||
      !active.solanaTransactionData
    ) {
      return active; // not a native-SOL Solana route — nothing to prepare.
    }

    let fromAmountLamports: bigint;
    try {
      fromAmountLamports = decimalToBaseUnits(amount, fromToken.decimals);
    } catch {
      return active;
    }

    let need;
    try {
      need = await detectWsolSetupNeed({
        transactionBase64: active.solanaTransactionData,
        walletAddress: solanaAddress,
        fromAmountLamports: fromAmountLamports.toString(),
      });
    } catch {
      // Detection failed (RPC) — proceed; simulation will surface the real error.
      return active;
    }

    // Required SOL = ONLY the top-up to wrap (lamportsToWrap, 0 when the wSOL ATA
    // is already funded) + ATA rent (0 when the ATA already exists) + the setup
    // tx fee + a bridge-tx fee reserve. We never add the full bridge amount again
    // (it IS the wrap) and never double-count rent. When no setup is needed,
    // lamportsToWrap and rent are 0 → required is just the fee reserve.
    const lamportsToWrap = BigInt(need.lamportsToWrap);
    const rentLamports = BigInt(need.rentLamports);
    const totalRequired =
      lamportsToWrap +
      rentLamports +
      WSOL_SETUP_FEE_RESERVE_LAMPORTS +
      SOL_FEE_RESERVE_LAMPORTS;

    const balanceLoaded =
      fromBalance.status === "loaded" && fromBalance.baseUnits != null;
    const balanceLamports = balanceLoaded
      ? BigInt(fromBalance.baseUnits as string)
      : null;
    const remainingAfterRequired =
      balanceLamports != null ? balanceLamports - totalRequired : null;

    // Always log the fee-reserve math for native-SOL routes (whether or not a
    // wSOL setup is needed) so the exact numbers are visible before any
    // insufficient-fee outcome.
    if (isBridgeDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.info("[bridge:solana] fee-reserve-check", {
        route: `${fromChain?.name ?? fromChainId} → ${toChain?.name ?? toChainId}`,
        walletBalanceLamports: balanceLamports?.toString() ?? "unknown",
        balanceStatus: fromBalance.status,
        fromAmountLamports: fromAmountLamports.toString(),
        isNativeSolSource: true,
        wsolSetupNeeded: need.needed,
        wsolAtaReferenced: need.referenced,
        wsolAtaExists: need.exists,
        currentWrappedAmount: need.currentWrappedAmount,
        lamportsToWrap: lamportsToWrap.toString(),
        rentLamports: rentLamports.toString(),
        setupFeeReserveLamports: WSOL_SETUP_FEE_RESERVE_LAMPORTS.toString(),
        bridgeFeeReserveLamports: SOL_FEE_RESERVE_LAMPORTS.toString(),
        totalRequiredLamports: totalRequired.toString(),
        remainingAfterRequired: remainingAfterRequired?.toString() ?? "unknown",
        // We only ever block on a balance we actually loaded — never on a
        // missing/errored balance; on-chain simulation stays authoritative.
        reason: !need.needed
          ? "no wSOL setup required for this route"
          : balanceLamports == null
            ? "balance unavailable — not gating; simulation is authoritative"
            : balanceLamports < totalRequired
              ? "insufficient: balance < lamportsToWrap + rent + fees"
              : "sufficient",
      });
    }

    if (!need.needed) return active;

    // Block ONLY when we have a real loaded balance that's genuinely short — a
    // missing/errored balance must never be reported as "insufficient fees".
    if (balanceLamports != null && balanceLamports < totalRequired) {
      setSubmitStatus("error");
      setError(
        rentLamports > 0n
          ? "This route needs a wrapped SOL account. Lower the amount to keep SOL for fees."
          : "Not enough SOL left for network fees. Lower the amount or add SOL.",
      );
      return null;
    }

    setSubmitStatus("preparingAccount");
    try {
      const setup = await walletService.executeSelectedSolanaWsolSetup({
        lamportsToWrap: need.lamportsToWrap,
      });
      wsolSetupSigRef.current = setup.signature;
      bridgeDebugLog("page:wsol-setup", {
        wsolAta: need.wsolAta,
        exists: need.exists,
        lamportsToWrap: need.lamportsToWrap,
        // The signature is a public identifier — safe to log.
        txHash: setup.signature,
      });
    } catch (e) {
      setSubmitStatus("error");
      setError(describeBridgeError(e));
      return null;
    }

    // Setup changed on-chain state and consumed a blockhash — get a FRESH bridge
    // route before signing rather than reusing the pre-setup transaction.
    setSubmitStatus("preparing");
    return refreshBeforeSign();
  }

  async function handleConfirm() {
    if (!quote?.executable || !fromToken || !toToken) return;
    setError(null);
    wsolSetupSigRef.current = null; // start clean — no stale setup hash.
    setSubmitStatus("preparing");

    // a–c: refresh + validate an executable route immediately before signing.
    let prepared: BridgeQuote | null;
    try {
      prepared = await refreshBeforeSign();
    } catch (e) {
      setSubmitStatus("error");
      setError(friendlyError(e));
      return;
    }
    if (!prepared) return; // refreshBeforeSign already set the UI state.

    // Solana invariant: the gating must have produced an executable, normalized,
    // deserializable payload. If any of these is missing we must NOT sign —
    // degrade the quote instead of letting a contradictory "executable" stand.
    if (prepared.txFormat === "solana") {
      if (
        prepared.executionStatus !== "executable" ||
        !prepared.solanaTransactionData ||
        !prepared.solanaTransactionFormat
      ) {
        logSolanaInvariantAfterGating({
          sourceField: prepared.solanaTransactionSourceField,
          byteLength: prepared.solanaTransactionByteLength,
          format: prepared.solanaTransactionFormat,
          executionStatus: prepared.executionStatus,
          code: "MISSING_NORMALIZED_TX",
        });
        degradeQuoteToUnsupported(
          prepared,
          "Provider returned a Solana transaction format Simpl cannot execute yet.",
        );
        setSubmitStatus("idle");
        setError(
          "The bridge provider returned a Solana transaction format Simpl cannot execute yet.",
        );
        return;
      }

      // Native-SOL routes: ensure a funded wSOL ATA exists (provider tx may run
      // TransferChecked against it). Sends a setup tx + refreshes the route if
      // needed; returns null when it set an error/preview state (we abort).
      let readied: BridgeQuote | null;
      try {
        readied = await maybePrepareWsolAndRefresh(prepared);
      } catch (e) {
        setSubmitStatus("error");
        setError(describeBridgeError(e));
        return;
      }
      if (!readied) return;
      prepared = readied;
    }

    // EVM ERC-20: re-validate allowance against the refreshed spender/amount. A
    // refreshed route can change the approval address; never sign without it.
    if (
      prepared.txFormat === "evm" &&
      !fromToken.isNative &&
      prepared.approvalAddress
    ) {
      try {
        const amountBase = decimalToBaseUnits(amount, fromToken.decimals);
        const allowance = await readErc20Allowance({
          chainId: fromChainId,
          tokenAddress: fromToken.address,
          owner: evmAddress ?? "",
          spender: prepared.approvalAddress,
        });
        if (allowance == null || allowance < amountBase) {
          setApprovalState("needed");
          setSubmitStatus("idle");
          setError("Approval is needed for this amount. Approve again and retry.");
          return;
        }
      } catch {
        // Allowance read failed — fall through; the send will surface a precise
        // allowance error if it's genuinely missing.
      }
    }

    // TRON ERC-20-equivalent: re-validate the TRC-20 allowance against the
    // refreshed spender/amount before signing. Never reuse EVM allowance code.
    if (
      prepared.txFormat === "tron" &&
      !fromToken.isNative &&
      prepared.approvalAddress
    ) {
      try {
        const amountBase = decimalToBaseUnits(amount, fromToken.decimals);
        const allowance = await readTrc20Allowance({
          owner: tronAddress ?? "",
          contractAddress: fromToken.address,
          spender: prepared.approvalAddress,
        });
        if (allowance == null || allowance < amountBase) {
          setApprovalState("needed");
          setSubmitStatus("idle");
          setError("TRC-20 approval required.");
          return;
        }
      } catch {
        // Allowance read failed — fall through; execution surfaces a precise error.
      }
    }

    // d–h: sign → simulate → broadcast → watch (the wallet-service Solana
    // pipeline does freshness/sign/simulate/broadcast; EVM goes through the send
    // service). On a stale Solana blockhash we auto-refresh the quote ONCE and
    // retry with the fresh transaction before surfacing an error to the user.
    setSubmitStatus("submitting");
    try {
      const exec = await executeBridgeTx(prepared);
      finalizeBridgeSuccess(prepared, exec);
      return;
    } catch (e) {
      const staleBlockhash =
        e instanceof SolanaError && e.code === "BLOCKHASH_EXPIRED";
      if (staleBlockhash && prepared.txFormat === "solana") {
        bridgeDebugLog("page:auto-refresh", { reason: "BLOCKHASH_EXPIRED" });
        setSubmitStatus("preparing");
        let fresh: BridgeQuote | null;
        try {
          fresh = await refreshBeforeSign();
        } catch (e2) {
          setSubmitStatus("error");
          setError(friendlyError(e2));
          return;
        }
        if (!fresh) return; // UI updated (materialChange / quoteOnly / …).
        setSubmitStatus("submitting");
        try {
          const exec = await executeBridgeTx(fresh);
          finalizeBridgeSuccess(fresh, exec);
          return;
        } catch (e3) {
          bridgeDebugLog("page:execute-error", {
            fromChain: fromChainId,
            toChain: toChainId,
            txFormat: fresh.txFormat,
            code: e3 instanceof SolanaError ? e3.code : "unknown",
            afterRefresh: true,
          });
          if (degradeOnUnsupportedFormat(fresh, e3)) return;
          setSubmitStatus("error");
          // Still stale even with a freshly-built tx → the provider keeps
          // returning an expired transaction.
          setError(
            e3 instanceof SolanaError && e3.code === "BLOCKHASH_EXPIRED"
              ? "This route keeps expiring before it can be signed. Please try again in a moment."
              : describeBridgeError(e3),
          );
          return;
        }
      }
      // Coded, display-safe diagnostics only — never the raw provider payload.
      bridgeDebugLog("page:execute-error", {
        fromChain: fromChainId,
        toChain: toChainId,
        txFormat: prepared.txFormat,
        code: e instanceof SolanaError ? e.code : "unknown",
      });
      // Only an UNSUPPORTED tx FORMAT degrades the route to unsupported. A
      // simulation / program / account failure keeps the route executable and
      // shows a specific reason — the user can retry with a fresh quote/amount.
      if (degradeOnUnsupportedFormat(prepared, e)) return;
      setSubmitStatus("error");
      setError(describeBridgeError(e));
    }
  }

  // Re-fetch a fresh route after a failed submit. A Solana-source bridge tx
  // carries an embedded blockhash that expires quickly, and an EVM route's
  // calldata can go stale — so "Try again" rebuilds the quote (fresh tx) rather
  // than re-broadcasting the same, possibly-expired, transaction.
  async function handleRetryAfterError() {
    setSubmitStatus("idle");
    await handleGetQuote();
  }

  // ── Light, bounded status polling on the success screen ──
  const pollRef = useRef(0);
  useEffect(() => {
    if (step !== "success" || !txHash || !quote) return;
    if (bridgeProgress !== "pending") return;
    pollRef.current = 0;
    let cancelled = false;
    let timer: number | null = null;

    async function poll() {
      if (cancelled || !txHash || !quote) return;
      pollRef.current += 1;
      try {
        const status = await getBridgeStatus({
          txHash,
          fromChainId,
          toChainId,
          bridgeKey: quote.toolKey,
        });
        if (cancelled) return;
        if (status.status === "DONE") {
          setBridgeProgress("confirmed");
          transactionHistoryService.updateStatus({
            chainId: fromChainId,
            hash: txHash,
            status: "confirmed",
          });
          return;
        }
        if (status.status === "FAILED") {
          setBridgeProgress("failed");
          transactionHistoryService.updateStatus({
            chainId: fromChainId,
            hash: txHash,
            status: "failed",
          });
          return;
        }
      } catch {
        // transient — keep trying until the attempt cap
      }
      if (!cancelled && pollRef.current < 12) {
        timer = window.setTimeout(poll, 8000);
      }
    }

    timer = window.setTimeout(poll, 8000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [step, txHash, quote, bridgeProgress, fromChainId, toChainId]);

  function handleNewBridge() {
    setStep("form");
    setQuote(null);
    setAmount("");
    setTxHash(null);
    setExplorerUrl(null);
    setError(null);
    setApprovalState("unknown");
    setSubmitStatus("idle");
    setBridgeProgress("pending");
    wsolSetupSigRef.current = null;
  }

  const estReceive = useMemo(() => {
    if (!quote || !toToken) return "—";
    return formatBaseUnits(quote.toAmountBaseUnits, quote.toTokenDecimals);
  }, [quote, toToken]);

  // Clear, directional route mode. When either side is Solana we name both ends
  // ("Solana → BNB Chain" / "BNB Chain → Solana"); a plain EVM↔EVM route keeps
  // the generic label.
  const routeModeLabel = useMemo(() => {
    const involvesSolana =
      fromChainId === LIFI_SOLANA_CHAIN_ID || toChainId === LIFI_SOLANA_CHAIN_ID;
    if (!involvesSolana) return "Cross-chain route";
    const fromName = fromChain?.name ?? getNetworkLabel(fromChainId);
    const toName = toChain?.name ?? getNetworkLabel(toChainId);
    return `${fromName} → ${toName}`;
  }, [fromChainId, toChainId, fromChain, toChain]);

  // The FROM token pays native SOL on Solana even when LI.FI's token is wSOL:
  // display "SOL" with native art (the quote still uses the LI.FI identifier).
  const fromIsSolNative = isSolanaNativeSource(fromChainId, fromToken ?? null);
  const fromDisplaySymbol = fromIsSolNative ? "SOL" : fromToken?.symbol;
  const fromDisplayName = fromIsSolNative ? "Solana" : fromToken?.name;

  // ── Success screen ──
  if (step === "success") {
    const statusTitle =
      bridgeProgress === "confirmed"
        ? "Cross-chain swap completed"
        : bridgeProgress === "failed"
          ? "Cross-chain swap failed"
          : "Cross-chain swap submitted";
    return (
      <div className="ext-popup swap-page" data-screen-label="Swap – Cross-chain">
        <SwapHeader title="Swap" subtitle={routeModeLabel} onBack={onBack} />
        <div className="screen-body">
          <div className="swap-quote-card" style={{ textAlign: "center", gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-1)" }}>
              {statusTitle}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {fromDisplaySymbol} {fromChain?.name} → {toToken?.symbol}{" "}
              {toChain?.name} via {quote?.toolName ?? "route"}
            </div>
          </div>
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>You sent</span>
              <strong>
                {amount} {fromDisplaySymbol}
              </strong>
            </div>
            <div className="swap-quote-row">
              <span>You receive (est.)</span>
              <strong>
                {estReceive} {toToken?.symbol}
              </strong>
            </div>
            <div className="swap-quote-row swap-quote-row--route">
              <span>Status</span>
              <strong>
                {bridgeProgress === "confirmed"
                  ? "Completed"
                  : bridgeProgress === "failed"
                    ? "Failed"
                    : "In progress"}
              </strong>
            </div>
          </div>
          <SwapRouteNotice>
            Cross-chain route powered by LI.FI. This may take longer than a
            same-chain swap.
          </SwapRouteNotice>
          <div className="swap-review-cta" style={{ display: "grid", gap: 8 }}>
            {explorerUrl ? (
              <a
                className="btn primary lg full"
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                View source transaction
              </a>
            ) : null}
            <button
              className="btn secondary lg full"
              type="button"
              onClick={onBack}
            >
              Back to wallet
            </button>
            <button
              className="btn secondary lg full"
              type="button"
              onClick={handleNewBridge}
            >
              New swap
            </button>
          </div>
        </div>
      </div>
    );
  }

  const previewOnly = Boolean(quote) && !quote?.executable;
  const isBusy =
    submitStatus === "preparingAccount" ||
    submitStatus === "preparing" ||
    submitStatus === "submitting" ||
    approvalState === "approving";

  return (
    <div className="ext-popup swap-page" data-screen-label="Swap – Cross-chain">
      <SwapHeader
        title={step === "review" ? "Review swap" : "Swap"}
        subtitle={routeModeLabel}
        onBack={step === "review" ? () => setStep("form") : onBack}
      />

      <div className="screen-body">
        {chainsError ? <div className="swap-error">{chainsError}</div> : null}

        {/* From — same structure as the same-chain Swap card so the layout
            never jumps when switching same-chain ↔ cross-chain. */}
        <div className="swap-pair-card">
          <div className="swap-half swap-half--from">
            <div className="swap-half-top">
              <span className="swap-half-label">From</span>
              <div className="swap-half-selectors">
                <button
                  className="swap-token-pill"
                  type="button"
                  onClick={() => {
                    if (step !== "form") return;
                    setTokenPicker("from");
                  }}
                  disabled={step !== "form"}
                >
                  {fromToken ? (
                    <TokenWithChainBadge
                      symbol={fromDisplaySymbol}
                      tokenLogoUrl={fromIsSolNative ? null : fromToken.logoUrl}
                      tokenAddress={
                        fromIsSolNative || fromToken.isNative ? null : fromToken.address
                      }
                      chainId={fromChainId}
                      chainName={fromChain?.name ?? getNetworkLabel(fromChainId)}
                      chainLogoUrl={fromChain?.logoUrl}
                      size={28}
                    />
                  ) : (
                    <span className="swap-token-pill__icon">?</span>
                  )}
                  <span className="swap-token-pill__sym">
                    {fromDisplaySymbol ?? "Token"}
                  </span>
                  <span className="swap-token-pill__chevron">▾</span>
                </button>
              </div>
            </div>
            <input
              className="swap-amount-input"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              disabled={step !== "form"}
              onChange={(e) => {
                setAmount(e.target.value);
                resetQuote();
              }}
            />
            <div className="swap-half-bottom">
              <span>{fromDisplayName ?? "—"}</span>
              <span className="swap-half-bottom__right">
                <span className="swap-half-bottom__bal">
                  {balanceLabel(fromBalance, fromDisplaySymbol)}
                </span>
                {step === "form" && fromBalance.status === "error" ? (
                  <button
                    className="swap-max-pill swap-percent-chip"
                    type="button"
                    onClick={() => setBalanceReloadKey((k) => k + 1)}
                  >
                    Retry
                  </button>
                ) : null}
                {step === "form" && fromBalancePositive ? (
                  <button
                    className="swap-max-pill swap-percent-chip"
                    type="button"
                    onClick={handleMax}
                  >
                    MAX
                  </button>
                ) : null}
              </span>
            </div>
          </div>

          <div className="swap-divider" />

          {/* To */}
          <div className="swap-half swap-half--to">
            <div className="swap-half-top">
              <span className="swap-half-label">To</span>
              <div className="swap-half-selectors">
                <button
                  className="swap-token-pill"
                  type="button"
                  onClick={() => {
                    if (step !== "form") return;
                    setTokenPicker("to");
                  }}
                  disabled={step !== "form"}
                >
                  {toToken ? (
                    <TokenWithChainBadge
                      symbol={toToken.symbol}
                      tokenLogoUrl={toToken.logoUrl}
                      tokenAddress={toToken.isNative ? null : toToken.address}
                      chainId={toChainId}
                      chainName={toChain?.name ?? getNetworkLabel(toChainId)}
                      chainLogoUrl={toChain?.logoUrl}
                      size={28}
                    />
                  ) : (
                    <span className="swap-token-pill__icon">?</span>
                  )}
                  <span className="swap-token-pill__sym">
                    {toToken?.symbol ?? "Token"}
                  </span>
                  <span className="swap-token-pill__chevron">▾</span>
                </button>
              </div>
            </div>
            <div
              className="swap-estimated-display swap-estimated-display--muted"
              role="status"
              aria-live="polite"
            >
              {estReceive}
            </div>
            <div className="swap-half-bottom">
              <span>{toToken?.name ?? "—"}</span>
              <span className="swap-half-bottom__bal">
                {balanceLabel(toBalance, toToken?.symbol)}
              </span>
            </div>
          </div>
        </div>

        <SwapRouteNotice>
          Cross-chain route powered by LI.FI. This may take longer than a
          same-chain swap.
        </SwapRouteNotice>

        {/* Slippage (form only) */}
        {step === "form" ? (
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>Max slippage</span>
              <span style={{ display: "flex", gap: 6 }}>
                {SLIPPAGE_PRESETS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    className="swap-percent-chip"
                    style={{
                      fontWeight: slippageBps === bps ? 700 : 500,
                      opacity: slippageBps === bps ? 1 : 0.6,
                    }}
                    onClick={() => {
                      setSlippageBps(bps);
                      resetQuote();
                    }}
                  >
                    {formatSlippage(bps)}
                  </button>
                ))}
              </span>
            </div>
          </div>
        ) : null}

        {/* Review summary */}
        {step === "review" && quote ? (
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>From</span>
              <strong>
                {amount} {fromDisplaySymbol} · {fromChain?.name}
              </strong>
            </div>
            <div className="swap-quote-row">
              <span>To (est.)</span>
              <strong>
                {estReceive} {toToken?.symbol} · {toChain?.name}
              </strong>
            </div>
            {quote.toAmountMinBaseUnits ? (
              <div className="swap-quote-row">
                <span>Minimum received</span>
                <strong>
                  {formatBaseUnits(
                    quote.toAmountMinBaseUnits,
                    quote.toTokenDecimals,
                  )}{" "}
                  {toToken?.symbol}
                </strong>
              </div>
            ) : null}
            <div className="swap-quote-row">
              <span>Route type</span>
              <strong>{routeModeLabel}</strong>
            </div>
            <div className="swap-quote-row swap-quote-row--route">
              <span>Provider</span>
              <strong>{quote.toolName} via LI.FI</strong>
            </div>
            {quote.feeCostBaseUnits && quote.feeCostSymbol ? (
              <div className="swap-quote-row">
                <span>Route fee</span>
                <strong>
                  {formatBaseUnits(quote.feeCostBaseUnits, quote.feeCostDecimals)}{" "}
                  {quote.feeCostSymbol}
                </strong>
              </div>
            ) : null}
            {quote.gasCostBaseUnits && quote.gasCostSymbol ? (
              <div className="swap-quote-row">
                <span>Gas estimate</span>
                <strong>
                  ~
                  {formatBaseUnits(quote.gasCostBaseUnits, quote.gasCostDecimals)}{" "}
                  {quote.gasCostSymbol}
                </strong>
              </div>
            ) : null}
            <div className="swap-quote-row">
              <span>Max slippage</span>
              <strong>{formatSlippage(slippageBps)}</strong>
            </div>
            {formatDuration(quote.estimatedDurationSeconds) ? (
              <div className="swap-quote-row">
                <span>Est. time</span>
                <strong>{formatDuration(quote.estimatedDurationSeconds)}</strong>
              </div>
            ) : null}
            <div className="swap-quote-row">
              <span>Status</span>
              <strong>
                {quote.executionStatus === "executable"
                  ? "Execution supported"
                  : quote.executionStatus === "quoteOnly"
                    ? "Quote only"
                    : "Unsupported route"}
              </strong>
            </div>
          </div>
        ) : null}

        {/* Preview-only (non-executable) notice — clean disabled state, never a
            broken confirm button. */}
        {step === "review" && previewOnly ? (
          <SwapRouteNotice variant="preview">
            {quote?.executionReason ?? "Route found, execution is not supported yet."}
          </SwapRouteNotice>
        ) : null}

        {error ? <div className="swap-error">{error}</div> : null}

        {/* Dev-only hint pointing at the safe Solana payload diagnostics. */}
        {import.meta.env.DEV &&
        step === "review" &&
        quote?.txFormat === "solana" &&
        (previewOnly || submitStatus === "error") ? (
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
            Dev: open Console and look for [bridge:solana] invalid-tx.
          </div>
        ) : null}

        {/* CTA */}
        <div className="swap-review-cta">
          {step === "form" ? (
            <button
              className="btn primary lg full"
              type="button"
              disabled={Boolean(validation) || reviewLoading}
              onClick={handleGetQuote}
            >
              {reviewLoading ? "Finding route…" : validation ?? "Review swap"}
            </button>
          ) : previewOnly ? (
            <button className="btn primary lg full" type="button" disabled>
              Execution coming soon
            </button>
          ) : approvalState === "needed" || approvalState === "approving" ? (
            <button
              className="btn primary lg full"
              type="button"
              disabled={approvalState === "approving"}
              onClick={handleApprove}
            >
              {approvalState === "approving"
                ? "Approving…"
                : `Approve ${fromToken?.symbol ?? "token"}`}
            </button>
          ) : (
            <button
              className="btn primary lg full"
              type="button"
              disabled={isBusy || approvalState === "checking" || reviewLoading}
              onClick={
                submitStatus === "error" ? handleRetryAfterError : handleConfirm
              }
            >
              {reviewLoading
                ? "Refreshing route…"
                : submitStatus === "preparingAccount"
                  ? "Preparing SOL account…"
                  : submitStatus === "preparing"
                    ? "Preparing fresh route…"
                    : submitStatus === "signing"
                      ? "Waiting for signature…"
                      : submitStatus === "submitting"
                        ? "Broadcasting…"
                        : submitStatus === "error"
                          ? "Get a fresh quote"
                          : approvalState === "checking"
                            ? "Checking allowance…"
                            : "Confirm swap"}
            </button>
          )}
        </div>
      </div>

      {/* Cross-network token picker — selecting a token sets that side's chain
          too, so a different-chain pick reshapes the route automatically. */}
      {tokenPicker ? (
        <CrossChainTokenPicker
          side={tokenPicker}
          currentChainId={tokenPicker === "from" ? fromChainId : toChainId}
          onSelect={handlePickToken}
          onClose={() => setTokenPicker(null)}
        />
      ) : null}
    </div>
  );
}
