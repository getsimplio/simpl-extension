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
  getBridgeStatus,
  isSignableSourceChain,
  readErc20Allowance,
  NoBridgeRouteError,
  LIFI_SOLANA_CHAIN_ID,
  type BridgeChain,
  type BridgeToken,
  type BridgeQuote,
} from "../../core/bridge/lifi-bridge.service";
import {
  SOLANA_MAINNET,
  getSolanaTransactionExplorerUrl,
} from "../../chains/solana/solana.config";
import {
  resolveChainTokenBalance,
  LOADING_BALANCE,
  UNAVAILABLE_BALANCE,
  type ResolvedBalance,
} from "../../core/balances/chain-balance.service";
import { getNetworkDisplayName } from "../../core/networks/chain-registry";
import { AssetIcon } from "../components/AssetIcon";
import { ChainPillButton } from "../components/ChainPillButton";
import { ChainIcon } from "../components/ChainIcon";
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
  // Called when the user collapses the pair back to a single chain (From === To).
  // The parent returns to the same-chain Swap flow for that chain so same-chain
  // routing always uses 0x / Jupiter, never LI.FI.
  onSameChainSelected?: (chainId: number) => void;
};

type Step = "form" | "review" | "success";
type Side = "from" | "to";
type PickerKind = "chain" | "token";
type ApprovalState =
  | "unknown"
  | "checking"
  | "needed"
  | "approving"
  | "approved"
  | "notNeeded";
type SubmitStatus = "idle" | "signing" | "submitting" | "error";

const SLIPPAGE_PRESETS = [10, 50, 100] as const;
const DEFAULT_FROM_CHAIN = 8453; // Base
const DEFAULT_TO_CHAIN = 56; // BNB Chain
const TOKEN_LIST_DISPLAY_CAP = 80;

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

function isEvmChain(chain: BridgeChain | undefined): boolean {
  return (chain?.chainType ?? "").toUpperCase() === "EVM";
}

// Map any failure to a short, user-facing message. NEVER returns the raw
// provider/ethers string — unknown failures collapse to a generic line so no
// JSON / calldata / revert dump / stack text can ever reach the UI.
function friendlyError(error: unknown): string {
  if (error instanceof NoBridgeRouteError) {
    return "No route found for this pair. Try another token, chain, or amount.";
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
    lower.includes("failed to fetch") ||
    lower.includes("network error") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return "Network is temporarily unavailable. Please try again.";
  }
  if (lower.includes("no route") || lower.includes("not found")) {
    return "No route found for this pair. Try another token, chain, or amount.";
  }
  // Unknown provider failure — generic only, never the raw message.
  return "Could not prepare this route. Try again.";
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

export function BridgePage({
  selectedAccount,
  walletState,
  onBack,
  onBridgeCompleted,
  initialFromChainId,
  initialToChainId,
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
  const [fromToken, setFromToken] = useState<BridgeToken | null>(null);
  const [toToken, setToToken] = useState<BridgeToken | null>(null);

  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  const [picker, setPicker] = useState<{ side: Side; kind: PickerKind } | null>(
    null,
  );
  const [pickerSearch, setPickerSearch] = useState("");

  const [step, setStep] = useState<Step>("form");
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [approvalState, setApprovalState] = useState<ApprovalState>("unknown");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    const owner = addressForChain(fromChain);
    if (!fromToken) {
      setFromBalance(UNAVAILABLE_BALANCE);
      return;
    }
    setFromBalance(LOADING_BALANCE);
    void resolveChainTokenBalance({
      owner,
      chainId: fromChainId,
      tokenAddress: fromToken.isNative ? null : fromToken.address,
      isNative: fromToken.isNative,
      decimals: fromToken.decimals,
    }).then((r) => {
      if (active) setFromBalance(r);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken, fromChainId, evmAddress, solanaAddress, tronAddress]);

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
    setFromToken(null);
    void (async () => {
      try {
        const list = await getBridgeTokens(fromChainId);
        if (!active) return;
        setFromTokens(list);
        setFromToken((cur) => cur ?? pickDefaultToken(list));
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
    setToToken(null);
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

  function handleSelectChain(chain: BridgeChain) {
    if (!picker) return;
    if (picker.side === "from") setFromChainId(chain.id);
    else setToChainId(chain.id);
    setPicker(null);
    setPickerSearch("");
    setAmount("");
    resetQuote();
  }

  function handleSelectToken(token: BridgeToken) {
    if (!picker) return;
    if (picker.side === "from") setFromToken(token);
    else setToToken(token);
    setPicker(null);
    setPickerSearch("");
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
        if (amountBase > BigInt(fromBalance.baseUnits)) {
          return `Insufficient ${fromToken.symbol}`;
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
    setAmount(formatBaseUnits(fromBalance.baseUnits, fromToken.decimals));
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
    const toAddress = addressForChain(toChain) ?? fromAddress;

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

  async function handleConfirm() {
    if (!quote?.executable || !fromToken || !toToken) return;
    setError(null);
    setSubmitStatus("submitting");
    try {
      let resultHash: string;
      let resultExplorerUrl: string | null;
      let historyFromAddress: string;
      let historyToAddress: string;

      if (quote.txFormat === "solana") {
        // Solana-source execution gate (req 7): executable + format solana +
        // serialized data + a Solana signer + the LI.FI Solana source chain.
        if (
          !quote.solanaTransactionData ||
          fromChainId !== LIFI_SOLANA_CHAIN_ID ||
          !solanaAddress
        ) {
          setSubmitStatus("error");
          setError("Route found, execution coming soon in Simpl.");
          return;
        }
        const solResult =
          await walletService.executeSelectedSolanaBridgeTransaction({
            transactionBase64: quote.solanaTransactionData,
          });
        resultHash = solResult.signature;
        resultExplorerUrl = getSolanaTransactionExplorerUrl(
          SOLANA_MAINNET,
          solResult.signature,
        );
        historyFromAddress = solResult.address;
        historyToAddress = solResult.address;
      } else {
        // EVM source (existing path) — unchanged.
        if (!quote.transactionRequest) return;
        const result = await walletService.sendPreparedTransactionForChain({
          transaction: {
            to: quote.transactionRequest.to,
            data: quote.transactionRequest.data,
            value: quote.transactionRequest.value,
          },
          chainId: fromChainId,
        });
        resultHash = result.hash;
        resultExplorerUrl = result.explorerUrl;
        historyFromAddress = evmAddress ?? "";
        historyToAddress = quote.transactionRequest.to;
      }

      const estReceive = formatBaseUnits(
        quote.toAmountBaseUnits,
        quote.toTokenDecimals,
      );
      const feeDisplay =
        quote.feeCostBaseUnits && quote.feeCostSymbol
          ? `${formatBaseUnits(quote.feeCostBaseUnits, quote.feeCostDecimals)} ${quote.feeCostSymbol}`
          : undefined;

      try {
        transactionHistoryService.addTransaction({
          hash: resultHash,
          chainId: fromChainId,
          chainName: fromChain?.name ?? `Chain ${fromChainId}`,
          direction: "bridge",
          status: "submitted",
          assetType: "bridge",
          assetSymbol: `${fromToken.symbol} → ${toToken.symbol}`,
          assetName: `Cross-chain swap ${fromToken.symbol} to ${toChain?.name ?? "destination"}`,
          contractAddress: null,
          amount: `${amount} ${fromToken.symbol}`,
          fromAddress: historyFromAddress,
          toAddress: historyToAddress,
          explorerUrl: resultExplorerUrl,
          createdAt: new Date().toISOString(),
          bridgeFromChainId: fromChainId,
          bridgeToChainId: toChainId,
          bridgeFromChainName: fromChain?.name,
          bridgeToChainName: toChain?.name,
          bridgeFromSymbol: fromToken.symbol,
          bridgeFromAmount: amount,
          bridgeToSymbol: toToken.symbol,
          bridgeToAmount: estReceive,
          bridgeProvider: quote.toolName,
          ...(feeDisplay ? { bridgeFee: feeDisplay } : {}),
        });
      } catch {
        // History is best-effort — never block a successful swap on it.
      }

      setTxHash(resultHash);
      setExplorerUrl(resultExplorerUrl);
      setBridgeProgress("pending");
      setSubmitStatus("idle");
      setStep("success");
      void onBridgeCompleted?.();
    } catch (e) {
      setSubmitStatus("error");
      setError(friendlyError(e));
    }
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
  }

  const estReceive = useMemo(() => {
    if (!quote || !toToken) return "—";
    return formatBaseUnits(quote.toAmountBaseUnits, quote.toTokenDecimals);
  }, [quote, toToken]);

  // ── Picker list (chains or tokens) ──
  const pickerItems = useMemo(() => {
    if (!picker) return null;
    const q = pickerSearch.trim().toLowerCase();
    if (picker.kind === "chain") {
      const list = chains.filter(
        (c) => !q || c.name.toLowerCase().includes(q),
      );
      return { kind: "chain" as const, chains: list };
    }
    const source = picker.side === "from" ? fromTokens : toTokens;
    const selected = picker.side === "from" ? fromToken : toToken;
    const filtered = source.filter((t) => {
      if (!q) return true;
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      );
    });
    // Always keep the selected token visible even past the display cap.
    const capped = filtered.slice(0, TOKEN_LIST_DISPLAY_CAP);
    if (selected && !capped.some((t) => t.address === selected.address)) {
      capped.unshift(selected);
    }
    return { kind: "token" as const, tokens: capped };
  }, [picker, pickerSearch, chains, fromTokens, toTokens, fromToken, toToken]);

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
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={onBack}
            aria-label="Back to wallet"
          >
            <BackArrow />
          </button>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            Swap
          </div>
        </div>
        <div className="screen-body">
          <div className="swap-quote-card" style={{ textAlign: "center", gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-1)" }}>
              {statusTitle}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {fromToken?.symbol} {fromChain?.name} → {toToken?.symbol}{" "}
              {toChain?.name} via {quote?.toolName ?? "route"}
            </div>
          </div>
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>You sent</span>
              <strong>
                {amount} {fromToken?.symbol}
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
          <div className="swap-cross-helper">
            Cross-chain route powered by LI.FI. This may take longer than a
            same-chain swap.
          </div>
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
    submitStatus === "submitting" || approvalState === "approving";

  return (
    <div className="ext-popup swap-page" data-screen-label="Swap – Cross-chain">
      <div className="bar-top">
        <button
          className="icbtn"
          type="button"
          onClick={step === "review" ? () => setStep("form") : onBack}
          aria-label="Back"
        >
          <BackArrow />
        </button>
        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {step === "review" ? "Review swap" : "Swap"}
        </div>
      </div>

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
                    setPicker({ side: "from", kind: "token" });
                    setPickerSearch("");
                  }}
                  disabled={step !== "form"}
                >
                  {fromToken ? (
                    <AssetIcon
                      ticker={fromToken.symbol}
                      logoURI={fromToken.logoUrl}
                      address={fromToken.isNative ? null : fromToken.address}
                      chainId={fromChainId}
                      size={28}
                      className="swap-token-pill__img"
                    />
                  ) : (
                    <span className="swap-token-pill__icon">?</span>
                  )}
                  <span className="swap-token-pill__sym">
                    {fromToken?.symbol ?? "Token"}
                  </span>
                  <span className="swap-token-pill__chevron">▾</span>
                </button>
                <ChainPillButton
                  chainId={fromChainId}
                  name={fromChain?.name ?? getNetworkLabel(fromChainId)}
                  logoUrl={fromChain?.logoUrl}
                  disabled={step !== "form"}
                  onClick={() => {
                    setPicker({ side: "from", kind: "chain" });
                    setPickerSearch("");
                  }}
                  ariaLabel={`Source chain: ${fromChain?.name ?? ""}`}
                />
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
              <span>{fromToken?.name ?? "—"}</span>
              <span className="swap-half-bottom__right">
                <span className="swap-half-bottom__bal">
                  {balanceLabel(fromBalance, fromToken?.symbol)}
                </span>
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
                    setPicker({ side: "to", kind: "token" });
                    setPickerSearch("");
                  }}
                  disabled={step !== "form"}
                >
                  {toToken ? (
                    <AssetIcon
                      ticker={toToken.symbol}
                      logoURI={toToken.logoUrl}
                      address={toToken.isNative ? null : toToken.address}
                      chainId={toChainId}
                      size={28}
                      className="swap-token-pill__img"
                    />
                  ) : (
                    <span className="swap-token-pill__icon">?</span>
                  )}
                  <span className="swap-token-pill__sym">
                    {toToken?.symbol ?? "Token"}
                  </span>
                  <span className="swap-token-pill__chevron">▾</span>
                </button>
                <ChainPillButton
                  chainId={toChainId}
                  name={toChain?.name ?? getNetworkLabel(toChainId)}
                  logoUrl={toChain?.logoUrl}
                  disabled={step !== "form"}
                  onClick={() => {
                    setPicker({ side: "to", kind: "chain" });
                    setPickerSearch("");
                  }}
                  ariaLabel={`Destination chain: ${toChain?.name ?? ""}`}
                />
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

        <div className="swap-cross-helper">
          Cross-chain route powered by LI.FI. This may take longer than a
          same-chain swap.
        </div>

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
                {amount} {fromToken?.symbol} · {fromChain?.name}
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
              <strong>Cross-chain route</strong>
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
                {quote.executable
                  ? "Execution supported"
                  : "Execution coming soon in Simpl"}
              </strong>
            </div>
          </div>
        ) : null}

        {/* Preview-only (non-executable) notice */}
        {step === "review" && previewOnly ? (
          <div className="swap-preview-note">
            Route found, execution coming soon in Simpl.
          </div>
        ) : null}

        {error ? <div className="swap-error">{error}</div> : null}

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
              disabled={isBusy || approvalState === "checking"}
              onClick={handleConfirm}
            >
              {submitStatus === "submitting"
                ? "Swapping…"
                : submitStatus === "error"
                  ? "Try again"
                  : approvalState === "checking"
                    ? "Checking allowance…"
                    : "Confirm swap"}
            </button>
          )}
        </div>
      </div>

      {/* Chain / token picker */}
      {picker && pickerItems ? (
        <div
          className="swap-token-modal-backdrop"
          onClick={() => {
            setPicker(null);
            setPickerSearch("");
          }}
        >
          <div
            className="swap-token-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="swap-token-modal-header">
              <div>
                <h2>
                  {picker.kind === "chain" ? "Select chain" : "Select token"}
                </h2>
                <p>{picker.side === "from" ? "Source" : "Destination"}</p>
              </div>
              <button
                className="icbtn"
                type="button"
                onClick={() => {
                  setPicker(null);
                  setPickerSearch("");
                }}
              >
                ×
              </button>
            </div>
            <input
              className="swap-picker-search"
              placeholder={
                picker.kind === "chain" ? "Search chains" : "Search tokens"
              }
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
            <div className="swap-token-list">
              {pickerItems.kind === "chain"
                ? pickerItems.chains.map((chain) => (
                    <button
                      key={chain.id}
                      className="swap-token-list-item"
                      type="button"
                      onClick={() => handleSelectChain(chain)}
                    >
                      <ChainIcon
                        chainId={chain.id}
                        name={chain.name}
                        logoUrl={chain.logoUrl}
                        size={28}
                      />
                      <span className="swap-token-list-body">
                        <strong>
                          {chain.name}
                          {!chain.signable ? (
                            <span className="swap-chain-row__tag">
                              Preview only
                            </span>
                          ) : null}
                        </strong>
                        <span>
                          {isEvmChain(chain)
                            ? chain.signable
                              ? "Executable"
                              : "Cross-chain destination"
                            : "Cross-chain destination"}
                        </span>
                      </span>
                    </button>
                  ))
                : pickerItems.tokens.map((token) => (
                    <button
                      key={`${token.chainId}:${token.address}`}
                      className="swap-token-list-item"
                      type="button"
                      onClick={() => handleSelectToken(token)}
                    >
                      <AssetIcon
                        ticker={token.symbol}
                        logoURI={token.logoUrl}
                        address={token.isNative ? null : token.address}
                        chainId={token.chainId}
                        size={32}
                        className="swap-token-list-img"
                      />
                      <span className="swap-token-list-body">
                        <strong>{token.symbol}</strong>
                        <span>{token.name}</span>
                      </span>
                    </button>
                  ))}
              {((pickerItems.kind === "chain" &&
                pickerItems.chains.length === 0) ||
                (pickerItems.kind === "token" &&
                  pickerItems.tokens.length === 0)) && (
                <div className="swap-picker-empty">No matches.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BackArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 19l-7-7 7-7" />
    </svg>
  );
}
