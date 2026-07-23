// src/popup/routes/SolanaSwapPage.tsx
//
// Solana swap flow, backed end-to-end by Simpl API (Jupiter server-side). The
// extension only ever calls Simpl API — never Jupiter directly. Flow:
//   1. build a token list from the Solana portfolio (+ SOL / USDC defaults)
//   2. user picks from/to + amount → POST /v1/solana/swap/order  (unsigned tx)
//   3. Confirm → sign the VersionedTransaction locally (wallet.service)
//   4. POST /v1/solana/swap/execute with the signed tx + requestId
//   5. show pending → success (signature + explorer link) / failure
//
// Kept entirely separate from the EVM 0x SwapPage so EVM swap is untouched. The
// private key never leaves the extension; only the signed base64 tx is sent.

import { useEffect, useMemo, useState } from "react";
import { t, useTranslation } from "../../i18n";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import { walletService } from "../../core/wallet/wallet.service";
import { transactionHistoryService } from "../../core/transactions/transaction-history.service";
import {
  getRequiredSolanaConfigByChainId,
  getSolanaTransactionExplorerUrl,
} from "../../chains/solana/solana.config";
import {
  createSolanaSwapOrder,
  executeSolanaSwap,
  getExecuteSignature,
  SOL_WSOL_MINT,
  USDC_SOLANA_MINT,
  type SolanaSwapOrder,
} from "../../core/swaps/solana-swap.service";
import { LIFI_SOLANA_CHAIN_ID } from "../../core/bridge/lifi-bridge.service";
import { AssetIcon } from "../components/AssetIcon";
import { TokenWithChainBadge } from "../components/TokenWithChainBadge";
import { SwapHeader } from "../components/SwapHeader";
import { SwapRouteNotice } from "../components/SwapRouteNotice";
import {
  CrossChainTokenPicker,
  type PickerToken,
} from "../components/CrossChainTokenPicker";
import {
  isSwapAssetAllowed,
  toConfigChainId,
} from "../../core/config/swap-asset-availability";
import {
  useBridgeAssetAllowlist,
  useSwapAssetAllowlist,
} from "../hooks/useSwapAssetAllowlist";
import { BridgePage } from "./BridgePage";
import "./SwapPage.css";

type SolanaSwapPageProps = {
  selectedAccount: WalletAccount | null;
  walletState: WalletState;
  selectedChainId: number;
  onBack: () => void;
  onSwapCompleted?: () => void | Promise<void>;
  initialToAsset?: WalletAssetBalance | null;
};

type SolToken = {
  id: string;
  symbol: string;
  name: string;
  balance: string; // human-formatted (display only)
  balanceRaw: string; // base units (for the insufficient-balance check)
  decimals: number;
  isNative: boolean;
  mint: string; // wSOL mint for native, else the SPL mint (base58, verbatim)
  logoUrl: string | null;
};

type Step = "form" | "review" | "success";
type SubmitStatus = "idle" | "signing" | "executing" | "error";

const SLIPPAGE_PRESETS = [10, 50, 100] as const;

// Native SOL can't be spent to the last lamport: the network fee, rent for any
// token account the swap opens, and the wSOL wrap all need SOL to remain. MAX
// and validation reserve this amount so a "full balance" SOL swap doesn't fail
// upstream. SPL tokens have no such reserve — their full balance is spendable.
const SOL_FEE_RESERVE = "0.003";

function solReserveBaseUnits(decimals: number): bigint {
  try {
    return decimalToBaseUnits(SOL_FEE_RESERVE, decimals);
  } catch {
    return 0n;
  }
}

// Convert a UI decimal string to base units, REJECTING (never rounding) more
// fractional digits than the token supports.
function decimalToBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d*(?:\.\d*)?$/u.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(t("errors.invalidAmount"));
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`Too many decimals — max ${decimals}.`);
  }
  const padded = fracPart.padEnd(decimals, "0");
  return (
    BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0")
  );
}

// Format base units as a trimmed decimal string for display.
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
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/u, "");
  return `${whole.toString()}.${fracStr}`;
}

function formatPriceImpact(order: SolanaSwapOrder | null): string {
  const raw = order?.priceImpactPct ?? order?.priceImpact;
  if (raw == null) return "—";
  const pct = Number(raw) * 100;
  if (!Number.isFinite(pct)) return "—";
  return `${pct < 0.01 && pct > 0 ? "<0.01" : pct.toFixed(2)}%`;
}

function formatSlippage(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

// Format a fee in basis points as a trimmed percent (50 → "0.5%", 100 → "1%").
function formatFeeBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// Resolve which fee (basis points) to display, preferring the actual fee the
// backend applied and falling back to the requested one. Returns null when no
// fee is present so the row can be omitted entirely. Referral account and fee
// mint are deliberately ignored — they are never surfaced to the user.
function resolveFeeBps(order: SolanaSwapOrder | null): number | null {
  if (!order) return null;
  if (typeof order.actualFeeBps === "number") return order.actualFeeBps;
  if (typeof order.requestedFeeBps === "number") return order.requestedFeeBps;
  return null;
}

function assetToSolToken(asset: WalletAssetBalance): SolToken {
  const isNative = asset.type === "native";
  return {
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    balance: asset.formatted,
    balanceRaw: asset.balanceRaw,
    decimals: asset.decimals,
    isNative,
    mint: isNative ? SOL_WSOL_MINT : asset.contractAddress ?? "",
    logoUrl: asset.logoUrl ?? null,
  };
}

export function SolanaSwapPage({
  selectedAccount,
  walletState,
  selectedChainId,
  onBack,
  onSwapCompleted,
  initialToAsset,
}: SolanaSwapPageProps) {
  const { t } = useTranslation();
  const config = useMemo(
    () => getRequiredSolanaConfigByChainId(selectedChainId),
    [selectedChainId],
  );
  // Stage 3 runtime-config projection: admin-allowed swap/bridge assets.
  // null → no gating (offline / fallback / seed config), lists behave exactly
  // as before. A same-chain (Solana) pick executes as a swap → swap toggle; a
  // cross-chain pick executes as a bridge → bridge toggle.
  const swapAllowlist = useSwapAssetAllowlist();
  const bridgeAllowlist = useBridgeAssetAllowlist();
  const isPickerTokenAllowed = useMemo(
    () =>
      swapAllowlist || bridgeAllowlist
        ? (token: PickerToken) => {
            const sameChain =
              toConfigChainId(token.chainId) === toConfigChainId(selectedChainId);
            return isSwapAssetAllowed(sameChain ? swapAllowlist : bridgeAllowlist, {
              chainId: token.chainId,
              address: token.address,
              isNative: token.isNative,
            });
          }
        : undefined,
    [swapAllowlist, bridgeAllowlist, selectedChainId],
  );

  const solanaAddress =
    selectedAccount && "solanaAddress" in selectedAccount
      ? selectedAccount.solanaAddress ?? null
      : null;
  const isWatchOnly = selectedAccount?.type === "watch";

  const [tokens, setTokens] = useState<SolToken[]>([]);
  const [balancesKnown, setBalancesKnown] = useState(false);
  const [fromToken, setFromToken] = useState<SolToken | null>(null);
  const [toToken, setToToken] = useState<SolToken | null>(null);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  // FROM uses the Solana-only token list ("from"); TO uses the shared
  // cross-chain picker (toPickerOpen) so a receive token on another network can
  // reshape the route into a Solana → EVM bridge.
  const [picker, setPicker] = useState<"from" | null>(null);
  const [toPickerOpen, setToPickerOpen] = useState(false);
  // When the user picks a receive token on an EVM chain, we hand off to the
  // LI.FI bridge flow (Solana source). null = stay in the Jupiter same-chain UI.
  const [bridgeTo, setBridgeTo] = useState<PickerToken | null>(null);

  const [step, setStep] = useState<Step>("form");
  const [order, setOrder] = useState<SolanaSwapOrder | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  // Build the selectable token list: portfolio assets + always-available SOL and
  // USDC defaults (USDC selectable as output even when the user holds none).
  useEffect(() => {
    let active = true;
    void (async () => {
      let list: SolToken[] = [];
      let known = false;
      try {
        const portfolio = await walletService.getSelectedPortfolio();
        if (!active) return;
        list = portfolio.assets
          .filter(
            (a) =>
              a.chainId === selectedChainId &&
              (a.type === "native" || a.type === "spl"),
          )
          .map(assetToSolToken);
        known = true;
      } catch {
        // Portfolio (RPC) failed — still let the user swap with defaults; the
        // client balance check is skipped and the backend validates balances.
        list = [];
        known = false;
      }
      if (!active) return;

      // Ensure native SOL is present.
      if (!list.some((t) => t.isNative)) {
        list.unshift({
          id: `native:${selectedChainId}`,
          symbol: config.symbol,
          name: config.name,
          balance: "0",
          balanceRaw: "0",
          decimals: config.decimals,
          isNative: true,
          mint: SOL_WSOL_MINT,
          logoUrl: null,
        });
      }
      // Ensure USDC is selectable even with zero balance.
      if (!list.some((t) => t.mint === USDC_SOLANA_MINT)) {
        list.push({
          id: `spl:${selectedChainId}:${USDC_SOLANA_MINT}`,
          symbol: "USDC",
          name: "USD Coin",
          balance: "0",
          balanceRaw: "0",
          decimals: 6,
          isNative: false,
          mint: USDC_SOLANA_MINT,
          logoUrl: null,
        });
      }

      // Stage 3: only admin-allowed assets are offered for swapping (the
      // SOL/USDC seeds obey the allowlist too).
      list = list.filter((token) =>
        isSwapAssetAllowed(swapAllowlist, {
          chainId: selectedChainId,
          address: token.mint,
          isNative: token.isNative,
        }),
      );

      setTokens(list);
      setBalancesKnown(known);

      const sol = list.find((t) => t.isNative) ?? list[0] ?? null;
      const usdc =
        list.find((t) => t.mint === USDC_SOLANA_MINT) ??
        list.find((t) => t.mint !== sol?.mint) ??
        null;

      // The asset the user opened Swap from (the "anchor"). We pick From/To
      // around it so the swap is immediately useful:
      //   • native SOL          → From SOL,   To USDC
      //   • SPL with balance > 0 → From token, To SOL  (sell what you hold)
      //   • SPL with balance = 0 → From SOL,   To token (buy it)
      // No anchor (opened from the Swap action bar) → From SOL, To USDC.
      const anchorMint =
        initialToAsset?.type === "native"
          ? SOL_WSOL_MINT
          : initialToAsset?.contractAddress ?? null;
      const anchor = anchorMint
        ? list.find((t) => t.mint === anchorMint) ?? null
        : null;

      let from: SolToken | null = sol;
      let to: SolToken | null = usdc;
      if (anchor) {
        if (anchor.isNative) {
          from = sol;
          to = usdc;
        } else {
          // Held check from the detail asset's own balance (what the user saw),
          // falling back to the list entry.
          let anchorHeld = false;
          try {
            anchorHeld =
              BigInt(initialToAsset?.balanceRaw ?? anchor.balanceRaw ?? "0") >
              0n;
          } catch {
            anchorHeld = false;
          }
          if (anchorHeld) {
            from = anchor; // sell the held token …
            to = sol; // … into SOL
          } else {
            from = sol; // buy the token …
            to = anchor; // … with SOL
          }
        }
      }
      // Never the same token on both sides.
      if (from && to && from.mint === to.mint) {
        to =
          list.find((t) => t.mint === USDC_SOLANA_MINT && t.mint !== from?.mint) ??
          list.find((t) => t.mint !== from?.mint) ??
          null;
      }

      setFromToken((cur) => cur ?? from);
      setToToken((cur) => cur ?? to);
    })();
    return () => {
      active = false;
    };
  }, [selectedChainId, config, initialToAsset, swapAllowlist]);

  // Stage 3: re-validate the current picks when the allowlist narrows — the
  // list effect above preserves an existing selection (cur ?? from), so a
  // token that became disallowed must be corrected here.
  useEffect(() => {
    if (!swapAllowlist) return;
    const allowed = (token: SolToken | null) =>
      !token ||
      isSwapAssetAllowed(swapAllowlist, {
        chainId: selectedChainId,
        address: token.mint,
        isNative: token.isNative,
      });
    setFromToken((cur) =>
      allowed(cur) ? cur : tokens.find((t) => t.isNative) ?? tokens[0] ?? null,
    );
    setToToken((cur) =>
      allowed(cur)
        ? cur
        : tokens.find((t) => t.mint === USDC_SOLANA_MINT) ??
          tokens.find((t) => !t.isNative) ??
          null,
    );
  }, [swapAllowlist, tokens, selectedChainId]);

  // Any input change invalidates a prepared order (its blockhash/quote is stale).
  function resetOrder() {
    setOrder(null);
    setError(null);
    if (step === "review") setStep("form");
  }

  // FROM picker (Solana-only list).
  function handleSelectToken(token: SolToken) {
    if (picker === "from") {
      if (toToken && token.mint === toToken.mint) setToToken(fromToken);
      setFromToken(token);
    }
    setPicker(null);
    resetOrder();
  }

  // TO picker (shared cross-chain picker). A Solana-mainnet pick stays in the
  // Jupiter same-chain flow; an EVM pick hands off to the LI.FI bridge flow
  // (Solana → EVM) — never Jupiter, never 0x.
  function handlePickTo(p: PickerToken) {
    setToPickerOpen(false);
    if (p.chainId === LIFI_SOLANA_CHAIN_ID) {
      // Native SOL has no EVM-style zero address, so the picker reports it as
      // non-native; detect it by symbol and use the wSOL mint Jupiter expects.
      const isSol = p.symbol.toUpperCase() === "SOL";
      const picked: SolToken = {
        id: `cc:${p.chainId}:${p.address}`,
        symbol: p.symbol,
        name: p.name,
        balance: "0",
        balanceRaw: "0",
        decimals: p.decimals,
        isNative: isSol,
        mint: isSol ? SOL_WSOL_MINT : p.address,
        logoUrl: p.logoUrl ?? null,
      };
      if (fromToken && picked.mint === fromToken.mint) {
        // Avoid the same token on both sides — swap the FROM side out.
        setFromToken(toToken);
      }
      setToToken(picked);
      resetOrder();
      return;
    }
    // EVM destination → enter the LI.FI bridge flow (Solana source).
    setBridgeTo(p);
  }

  function handleSwitch() {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount("");
    resetOrder();
  }

  function handleMax() {
    if (!fromToken || !balancesKnown) return;
    // SPL tokens: full balance is spendable.
    if (!fromToken.isNative) {
      setAmount(fromToken.balance);
      resetOrder();
      return;
    }
    // Native SOL: leave the fee reserve. If the whole balance is within the
    // reserve, MAX is 0 and validation surfaces the "not enough SOL" message.
    let balanceRaw: bigint;
    try {
      balanceRaw = BigInt(fromToken.balanceRaw);
    } catch {
      balanceRaw = 0n;
    }
    const reserve = solReserveBaseUnits(fromToken.decimals);
    const maxRaw = balanceRaw > reserve ? balanceRaw - reserve : 0n;
    setAmount(formatBaseUnits(maxRaw.toString(), fromToken.decimals));
    resetOrder();
  }

  const validation = useMemo<string | null>(() => {
    if (isWatchOnly) return t("swap.watchOnlyCannotSwap");
    if (!solanaAddress) return "Solana address unavailable for this account.";
    if (!fromToken || !toToken) return t("bridge.selectTokensToSwap");
    if (fromToken.mint === toToken.mint) return "Choose two different tokens.";
    // The discovered Wrapped SOL token (non-native, NATIVE_MINT) can't be swapped
    // directly here — Jupiter wrap/unwrap expects native SOL. Show a clear,
    // non-generic message instead of a vague "Could not prepare this swap".
    if (!fromToken.isNative && fromToken.mint === SOL_WSOL_MINT) {
      return "Unwrap SOL first, then swap SOL.";
    }

    // Native SOL with a balance that can't even cover the fee reserve: no SOL
    // swap is possible regardless of the amount entered.
    if (fromToken.isNative && balancesKnown) {
      let balanceRaw: bigint;
      try {
        balanceRaw = BigInt(fromToken.balanceRaw);
      } catch {
        balanceRaw = 0n;
      }
      if (
        balanceRaw > 0n &&
        balanceRaw <= solReserveBaseUnits(fromToken.decimals)
      ) {
        return "Not enough SOL after reserving network fees.";
      }
    }

    if (!amount.trim() || Number(amount) <= 0) return t("swap.enterAmount");
    let amountBase: bigint;
    try {
      amountBase = decimalToBaseUnits(amount, fromToken.decimals);
    } catch (e) {
      return e instanceof Error ? e.message : t("errors.invalidAmount");
    }
    if (amountBase <= 0n) return t("swap.enterAmount");
    if (balancesKnown) {
      try {
        const balanceRaw = BigInt(fromToken.balanceRaw);
        if (fromToken.isNative) {
          // Block swaps that would leave less than the fee reserve behind —
          // this is what makes a "full balance" SOL swap fail upstream.
          if (amountBase + solReserveBaseUnits(fromToken.decimals) > balanceRaw) {
            return "Keep some SOL for network fees.";
          }
        } else if (amountBase > balanceRaw) {
          return t("swap.insufficientBalance");
        }
      } catch {
        // Unknown balance — let the backend validate.
      }
    }
    return null;
  }, [
    isWatchOnly,
    solanaAddress,
    fromToken,
    toToken,
    amount,
    balancesKnown,
  ]);

  async function handleReview() {
    if (validation || !fromToken || !toToken || !solanaAddress) {
      setError(validation);
      return;
    }
    setError(null);
    setReviewLoading(true);
    try {
      const amountBase = decimalToBaseUnits(amount, fromToken.decimals);
      const nextOrder = await createSolanaSwapOrder({
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amount: amountBase.toString(),
        userPublicKey: solanaAddress,
        slippageBps,
      });
      if (!nextOrder.transaction || !nextOrder.requestId) {
        throw new Error(t("swap.couldNotPrepare"));
      }
      setOrder(nextOrder);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("swap.couldNotPrepare"));
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleConfirm() {
    if (!order?.transaction || !order.requestId || !fromToken || !toToken) {
      return;
    }
    setError(null);
    try {
      setSubmitStatus("signing");
      const signed = await walletService.signSelectedSolanaSwapTransaction({
        transactionBase64: order.transaction,
      });

      setSubmitStatus("executing");
      const result = await executeSolanaSwap({
        signedTransaction: signed.signedTransaction,
        requestId: order.requestId,
      });
      const sig = getExecuteSignature(result);
      if (!sig) {
        throw new Error(t("swap.couldNotPrepare"));
      }

      const outFormatted = formatBaseUnits(order.outAmount, toToken.decimals);
      try {
        transactionHistoryService.addTransaction({
          hash: sig,
          chainId: selectedChainId,
          chainName: config.name,
          direction: "swap",
          status: "submitted",
          assetType: "swap",
          assetSymbol: `${fromToken.symbol} → ${toToken.symbol}`,
          assetName: `${fromToken.name} to ${toToken.name}`,
          contractAddress: null,
          amount: `${amount} → ${outFormatted}`,
          fromAddress: signed.address,
          toAddress: signed.address,
          explorerUrl: getSolanaTransactionExplorerUrl(config, sig),
          createdAt: new Date().toISOString(),
          swapFromSymbol: fromToken.symbol,
          swapFromAmount: amount,
          swapToSymbol: toToken.symbol,
          swapToAmount: outFormatted,
          swapFromMint: fromToken.mint,
          swapToMint: toToken.mint,
          swapRoute: "Jupiter",
          swapSlippage: formatSlippage(slippageBps),
          ...(order.simplFeeApplied && order.actualFeeBps != null
            ? { swapSimpleFee: `${(order.actualFeeBps / 100).toFixed(2)}%` }
            : {}),
        });
      } catch {
        // History is best-effort — never block a successful swap on it.
      }

      setSignature(sig);
      setStep("success");
      setSubmitStatus("idle");
      void onSwapCompleted?.();
    } catch (e) {
      setSubmitStatus("error");
      setError(e instanceof Error ? e.message : t("swap.swapFailed"));
    }
  }

  function handleNewSwap() {
    setStep("form");
    setOrder(null);
    setAmount("");
    setSignature(null);
    setError(null);
    setSubmitStatus("idle");
  }

  const explorerUrl = signature
    ? getSolanaTransactionExplorerUrl(config, signature)
    : null;
  const estimatedOut =
    order && toToken ? formatBaseUnits(order.outAmount, toToken.decimals) : "—";
  const isBusy = submitStatus === "signing" || submitStatus === "executing";

  // ── Cross-chain (Solana → EVM) bridge mode ──
  // The user picked a receive token on an EVM chain. Hand off to the LI.FI
  // bridge flow with the Solana source: fromChain = LI.FI Solana id, fromToken =
  // the current Solana FROM token, toChain/toToken = the EVM pick. BridgePage
  // owns address selection (Solana source → Solana address; EVM dest → EVM
  // address; no cross-type fallback) and route execution. Backing out or
  // collapsing the pair onto one chain returns here to the Jupiter flow.
  if (bridgeTo && fromToken) {
    return (
      <BridgePage
        selectedAccount={selectedAccount}
        walletState={walletState}
        initialFromChainId={LIFI_SOLANA_CHAIN_ID}
        initialFromToken={{
          chainId: LIFI_SOLANA_CHAIN_ID,
          address: fromToken.mint,
          symbol: fromToken.symbol,
          name: fromToken.name,
          decimals: fromToken.decimals,
          isNative: fromToken.isNative,
          logoUrl: fromToken.logoUrl,
        }}
        initialToChainId={bridgeTo.chainId}
        initialToToken={{
          chainId: bridgeTo.chainId,
          address: bridgeTo.address,
          symbol: bridgeTo.symbol,
          name: bridgeTo.name,
          decimals: bridgeTo.decimals,
          isNative: bridgeTo.isNative,
          logoUrl: bridgeTo.logoUrl ?? null,
        }}
        onSameChainSelected={() => setBridgeTo(null)}
        onBridgeCompleted={onSwapCompleted}
        onBack={() => setBridgeTo(null)}
      />
    );
  }

  // ── Success screen ──
  if (step === "success") {
    return (
      <div className="ext-popup swap-page" data-screen-label="Swap – Solana">
        <SwapHeader title={t("swap.title")} subtitle="Solana" onBack={onBack} />
        <div className="screen-body">
          <div className="swap-quote-card" style={{ textAlign: "center", gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-1)" }}>
              {t("swap.submitted")}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {fromToken?.symbol} → {toToken?.symbol} via Jupiter
            </div>
          </div>
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>{t("swap.youPaid")}</span>
              <strong>{amount} {fromToken?.symbol}</strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.youReceiveEst")}</span>
              <strong>{estimatedOut} {toToken?.symbol}</strong>
            </div>
            <div className="swap-quote-row swap-quote-row--route">
              <span>{t("swap.signature")}</span>
              <strong title={signature ?? undefined}>
                {signature ? `${signature.slice(0, 6)}…${signature.slice(-6)}` : "—"}
              </strong>
            </div>
          </div>
          <div className="swap-review-cta" style={{ display: "grid", gap: 8 }}>
            {explorerUrl ? (
              <a className="btn primary lg full" href={explorerUrl} target="_blank" rel="noreferrer">
                {t("common.viewOnExplorer")}
              </a>
            ) : null}
            <button className="btn secondary lg full" type="button" onClick={onBack}>
              {t("common.backToWallet")}
            </button>
            <button className="btn secondary lg full" type="button" onClick={handleNewSwap}>
              {t("swap.newSwap")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form / Review ──
  return (
    <div className="ext-popup swap-page" data-screen-label="Swap – Solana">
      <SwapHeader
        title={step === "review" ? t("swap.reviewSwap") : t("swap.title")}
        subtitle="Solana"
        onBack={step === "review" ? () => setStep("form") : onBack}
      />

      <div className="screen-body">
        {/* From / To pair */}
        <div className="swap-pair-card">
          <div className="swap-half swap-half--from">
            <div className="swap-half-top">
              <span className="swap-half-label">{t("swap.from")}</span>
              <button
                className="swap-token-pill"
                type="button"
                onClick={() => step === "form" && setPicker("from")}
                disabled={step !== "form"}
              >
                {fromToken ? (
                  <TokenWithChainBadge
                    symbol={fromToken.symbol}
                    tokenLogoUrl={fromToken.logoUrl}
                    tokenAddress={fromToken.isNative ? null : fromToken.mint}
                    chainId={selectedChainId}
                    chainName="Solana"
                    size={28}
                  />
                ) : (
                  <span className="swap-token-pill__icon">?</span>
                )}
                <span className="swap-token-pill__sym">{fromToken?.symbol ?? t("swap.select")}</span>
                <span className="swap-token-pill__chevron">▾</span>
              </button>
            </div>
            <input
              className="swap-amount-input"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              disabled={step !== "form"}
              onChange={(e) => {
                setAmount(e.target.value);
                resetOrder();
              }}
            />
            <div className="swap-half-bottom">
              <span className="swap-half-bottom__bal">
                {t("common.balance")}: {fromToken ? fromToken.balance : "—"} {fromToken?.symbol ?? ""}
              </span>
              {step === "form" && balancesKnown ? (
                <button className="swap-max-pill swap-percent-chip" type="button" onClick={handleMax}>
                  {t("common.max")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="swap-divider">
            <button
              className="swap-switch-btn"
              type="button"
              onClick={handleSwitch}
              disabled={step !== "form"}
              aria-label={t("swap.switchTokens")}
            >
              ⇅
            </button>
          </div>

          <div className="swap-half swap-half--to">
            <div className="swap-half-top">
              <span className="swap-half-label">{t("swap.estimatedReceive")}</span>
              <button
                className="swap-token-pill"
                type="button"
                onClick={() => step === "form" && setToPickerOpen(true)}
                disabled={step !== "form"}
              >
                {toToken ? (
                  <TokenWithChainBadge
                    symbol={toToken.symbol}
                    tokenLogoUrl={toToken.logoUrl}
                    tokenAddress={toToken.isNative ? null : toToken.mint}
                    chainId={selectedChainId}
                    chainName="Solana"
                    size={28}
                  />
                ) : (
                  <span className="swap-token-pill__icon">?</span>
                )}
                <span className="swap-token-pill__sym">{toToken?.symbol ?? t("swap.select")}</span>
                <span className="swap-token-pill__chevron">▾</span>
              </button>
            </div>
            {/* Read-only estimated output — a plain calculated value, not an
                input (no cursor / not focusable), so it never reads as a broken
                disabled field. Shows "—" until a quote is fetched. */}
            <div
              className="swap-estimated-display swap-estimated-display--muted"
              role="status"
              aria-live="polite"
              aria-label={`${t("swap.estimatedReceive")}${toToken ? ` ${toToken.symbol}` : ""}`}
              style={{ cursor: "default" }}
            >
              {estimatedOut}
            </div>
            <div className="swap-half-bottom">
              <span className="swap-half-bottom__bal">
                {t("swap.exactReceiveLater")}
              </span>
            </div>
          </div>
        </div>

        {/* Compact, shared route notice (no longer the large green block) —
            makes the Exact-In behavior obvious without dominating the screen. */}
        <SwapRouteNotice>
          {t("swap.exactInNotice")}
        </SwapRouteNotice>

        {/* Slippage presets (form only) */}
        {step === "form" ? (
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>{t("swap.maxSlippage")}</span>
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
                      resetOrder();
                    }}
                  >
                    {formatSlippage(bps)}
                  </button>
                ))}
              </span>
            </div>
          </div>
        ) : null}

        {/* Review details */}
        {step === "review" && order ? (
          <div className="swap-quote-card">
            <div className="swap-quote-row">
              <span>{t("swap.youPay")}</span>
              <strong>{amount} {fromToken?.symbol}</strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.youReceiveEst")}</span>
              <strong>{estimatedOut} {toToken?.symbol}</strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.priceImpact")}</span>
              <strong>{formatPriceImpact(order)}</strong>
            </div>
            <div className="swap-quote-row">
              <span>{t("swap.maxSlippage")}</span>
              <strong>{formatSlippage(slippageBps)}</strong>
            </div>
            <div className="swap-quote-row swap-quote-row--route">
              <span>{t("swap.route")}</span>
              <strong>Jupiter Ultra</strong>
            </div>
            {resolveFeeBps(order) != null ? (
              <div className="swap-quote-row">
                <span>{t("swap.simplFee")}</span>
                <strong>
                  {formatFeeBps(resolveFeeBps(order) as number)}
                  {order.simplFeeApplied ? (
                    <span className="swap-fee-tag swap-fee-tag--ok">{t("swap.feeIncluded")}</span>
                  ) : (order.requestedFeeBps ?? 0) > 0 ? (
                    <span className="swap-fee-tag swap-fee-tag--warn">{t("swap.feeNotApplied")}</span>
                  ) : null}
                </strong>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Fee transparency — subtle, premium, non-blocking. Never exposes the
            referral account, fee mint or any raw/debug field. */}
        {step === "review" && order ? (
          <div className="swap-fee-hint">
            {!order.simplFeeApplied && (order.requestedFeeBps ?? 0) > 0
              ? "Fee was not applied for this route. Fees are included in the quoted amount."
              : "Fees are included in the quoted amount. Powered by Jupiter."}
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
              onClick={handleReview}
            >
              {reviewLoading ? t("swap.findingRoute") : validation && amount ? validation : t("swap.reviewSwap")}
            </button>
          ) : (
            <button
              className="btn primary lg full"
              type="button"
              disabled={isBusy}
              onClick={handleConfirm}
            >
              {submitStatus === "signing"
                ? t("common.signing")
                : submitStatus === "executing"
                  ? t("swap.swapping")
                  : submitStatus === "error"
                    ? t("common.retry")
                    : t("swap.confirmSwap")}
            </button>
          )}
        </div>
      </div>

      {/* FROM picker — Solana-only list, a real wallet screen (not a modal):
          SwapHeader with a back button, no backdrop. The TO side uses the shared
          cross-chain picker below. */}
      {picker === "from" ? (
        <div className="swap-token-picker-page" role="dialog" aria-modal="true">
          <SwapHeader
            title={t("swap.selectTokenToSell")}
            subtitle="Solana"
            onBack={() => setPicker(null)}
          />
          <div className="cc-picker-body">
            {tokens.map((token) => (
              <button
                key={token.id}
                className="swap-token-list-item"
                type="button"
                onClick={() => handleSelectToken(token)}
              >
                <AssetIcon
                  ticker={token.symbol}
                  logoURI={token.logoUrl}
                  address={token.isNative ? null : token.mint}
                  chainId={selectedChainId}
                  size={32}
                  className="swap-token-list-img"
                />
                <span className="swap-token-list-body">
                  <strong>{token.symbol}</strong>
                  <span>{token.name}</span>
                </span>
                <span className="swap-token-list-balance">
                  {balancesKnown ? token.balance : "—"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* TO picker — shared cross-chain picker. A Solana pick stays in Jupiter
          mode; an EVM pick reshapes the route into a Solana → EVM bridge. */}
      {toPickerOpen ? (
        <CrossChainTokenPicker
          side="to"
          currentChainId={LIFI_SOLANA_CHAIN_ID}
          isTokenAllowed={isPickerTokenAllowed}
          onSelect={handlePickTo}
          onClose={() => setToPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
