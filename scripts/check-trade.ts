// scripts/check-trade.ts
//
// Unit smoke for the swap/bridge reliability layer (Stage 6): quote model, fee
// matrix, slippage/price-impact policy, preflight, error taxonomy, statuses.
// Run: npm run check:trade

import {
  isQuoteExpired,
  computeMinReceived,
  isQuoteConfirmable,
  highestWarningLevel,
  type SimplQuote,
} from "../src/core/trade/quote-model";
import {
  getFeePolicy,
  feeIsProductionSafe,
  isSimplFeeBpsValid,
  FEE_MATRIX,
} from "../src/core/trade/fee-policy";
import {
  evaluateSlippage,
  evaluatePriceImpact,
  clampSlippageBps,
  ABSOLUTE_MAX_SLIPPAGE_BPS,
  HARD_MAX_SLIPPAGE_BPS,
} from "../src/core/trade/slippage-policy";
import { runPreflight, type PreflightContext } from "../src/core/trade/preflight";
import { classifyTradeError, normalizeTradeError } from "../src/core/trade/trade-errors";
import { getTradeStatusInfo } from "../src/core/trade/trade-status";
import {
  parseTradeApiResponse,
  adaptLegacyZeroX,
  adaptLegacyLifi,
  mergeWarnings,
  isTradeQuoteExpired,
  isTradeQuoteConfirmable,
  TradeQuoteParseError,
  type SimplTradeWarning,
} from "../src/core/trade/quote-response";

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = 1_000_000;

function makeQuote(over: Partial<SimplQuote> = {}): SimplQuote {
  return {
    id: "q1",
    kind: "swap",
    provider: "zeroex",
    fromChainId: 1,
    toChainId: 1,
    fromToken: { symbol: "USDC", decimals: 6, amount: "1000000" },
    toToken: { symbol: "WETH", decimals: 18, estimatedAmount: "500000000000000", amount: "500000000000000" },
    fees: {},
    slippageBps: 50,
    expiresAt: NOW + 30_000,
    warnings: [],
    simulation: { status: "passed" },
    ...over,
  };
}

console.log("START SWAP/BRIDGE RELIABILITY CHECK\n");

// ── Quote model ──────────────────────────────────────────────────────────────
console.log("Quote model:");
check("fresh quote not expired", !isQuoteExpired(makeQuote(), NOW));
check("past-expiry quote is expired", isQuoteExpired(makeQuote({ expiresAt: NOW - 1 }), NOW));
check("minReceived applies slippage", computeMinReceived("1000000", 50) === "995000");
check("confirmable when fresh + passed", isQuoteConfirmable(makeQuote(), NOW));
check("not confirmable when expired", !isQuoteConfirmable(makeQuote({ expiresAt: NOW - 1 }), NOW));
check("not confirmable with blocked warning",
  !isQuoteConfirmable(makeQuote({ warnings: [{ code: "X", level: "blocked", message: "no" }] }), NOW));
check("not confirmable when simulation failed",
  !isQuoteConfirmable(makeQuote({ simulation: { status: "failed" } }), NOW));
check("highest warning level surfaced",
  highestWarningLevel(makeQuote({ warnings: [{ code: "a", level: "info", message: "" }, { code: "b", level: "danger", message: "" }] })) === "danger");

// ── Fee matrix ───────────────────────────────────────────────────────────────
console.log("\nFee enforcement matrix:");
check("0x swap fee is provider_enforced", getFeePolicy("zeroex", "swap")?.enforcement === "provider_enforced");
check("LI.FI fee is backend_authoritative (NOT client)", getFeePolicy("lifi", "bridge")?.enforcement === "backend_authoritative");
check("Jupiter fee is backend_authoritative", getFeePolicy("jupiter", "swap")?.enforcement === "backend_authoritative");
check("Pancake fee is unsupported (not a monetized route)", getFeePolicy("pancake", "swap")?.enforcement === "unsupported");
check("0x fee is production-safe", feeIsProductionSafe(getFeePolicy("zeroex", "swap")!));
check("LI.FI fee is production-safe", feeIsProductionSafe(getFeePolicy("lifi", "bridge")!));
check("Pancake fee is NOT production-safe", !feeIsProductionSafe(getFeePolicy("pancake", "swap")!));
check("every fee policy requiring production is proxy/provider enforced",
  FEE_MATRIX.filter((p) => p.allowProduction && p.enforcement !== "unsupported")
    .every((p) => p.enforcement === "provider_enforced" || p.enforcement === "backend_authoritative"));
check("fee bps bounds: 50 valid, 5000 invalid", isSimplFeeBpsValid(50) && !isSimplFeeBpsValid(5000));

// ── Slippage / price impact ─────────────────────────────────────────────────
console.log("\nSlippage / price impact:");
check("default slippage → info", evaluateSlippage(50).level === "info");
check("elevated slippage → warning", evaluateSlippage(200).level === "warning");
check("high slippage → danger + requires ack", (() => { const d = evaluateSlippage(800); return d.level === "danger" && d.requiresAcknowledgement === true && !d.allowed; })());
check("high slippage allowed WITH ack", evaluateSlippage(800, { acknowledged: true }).allowed);
check("absurd slippage (50%) → blocked", !evaluateSlippage(5000).allowed && evaluateSlippage(5000).level === "blocked");
check("clamp never exceeds absolute max", clampSlippageBps(5000) === ABSOLUTE_MAX_SLIPPAGE_BPS);
check("clamp floors at ≥1", clampSlippageBps(0) === 1);
check("HARD_MAX < ABSOLUTE_MAX", HARD_MAX_SLIPPAGE_BPS < ABSOLUTE_MAX_SLIPPAGE_BPS);
check("price impact 0.5% → info", evaluatePriceImpact(0.5).level === "info");
check("price impact 2% → warning", evaluatePriceImpact(2).level === "warning");
check("price impact 7% → danger + ack", evaluatePriceImpact(7).requiresAcknowledgement === true);
check("price impact 20% → blocked", !evaluatePriceImpact(20).allowed);
check("unknown price impact → not blocked, unavailable", evaluatePriceImpact(undefined).allowed);

// ── Preflight ────────────────────────────────────────────────────────────────
console.log("\nPreflight:");
const okCtx: PreflightContext = {
  quote: makeQuote(),
  nowMs: NOW,
  walletUnlocked: true,
  watchOnly: false,
  riskPassed: true,
  onCorrectChain: true,
  hasEnoughBalance: true,
  hasEnoughGas: true,
  allowanceSufficient: true,
};
check("clean context passes preflight", runPreflight(okCtx).ok);
check("watch-only blocks", !runPreflight({ ...okCtx, watchOnly: true }).ok);
check("locked blocks", !runPreflight({ ...okCtx, walletUnlocked: false }).ok);
check("risk-not-passed blocks", !runPreflight({ ...okCtx, riskPassed: false }).ok);
check("insufficient gas blocks", !runPreflight({ ...okCtx, hasEnoughGas: false }).ok);
check("expired quote blocks", !runPreflight({ ...okCtx, quote: makeQuote({ expiresAt: NOW - 1 }) }).ok);
check("simulation failed blocks", !runPreflight({ ...okCtx, quote: makeQuote({ simulation: { status: "failed" } }) }).ok);
check("extreme price impact blocks", !runPreflight({ ...okCtx, quote: makeQuote({ priceImpact: 20 }) }).ok);
check("approval-required is a warning, not a block",
  (() => { const r = runPreflight({ ...okCtx, allowanceSufficient: false }); return r.ok && r.warnings.some((w) => w.code === "ALLOWANCE_REQUIRED"); })());
check("bridge invalid destination blocks",
  !runPreflight({ ...okCtx, quote: makeQuote({ kind: "bridge", toChainId: 8453 }), destinationAddressValid: false }).ok);

// ── Error taxonomy ────────────────────────────────────────────────────────────
console.log("\nError taxonomy:");
check("insufficient funds → INSUFFICIENT_BALANCE", classifyTradeError("insufficient funds for transfer") === "INSUFFICIENT_BALANCE");
check("user rejected → TX_REJECTED", classifyTradeError(new Error("User rejected the request")) === "TX_REJECTED");
check("blockhash expired → QUOTE_EXPIRED", classifyTradeError("Blockhash not found") === "QUOTE_EXPIRED");
check("no route → ROUTE_UNAVAILABLE", classifyTradeError("No route found") === "ROUTE_UNAVAILABLE");
check("429 → PROVIDER_RATE_LIMITED", classifyTradeError("HTTP 429 too many requests") === "PROVIDER_RATE_LIMITED");
check("unknown → UNKNOWN_ERROR", classifyTradeError("weird gibberish xyz") === "UNKNOWN_ERROR");
const norm = normalizeTradeError(new Error("execution reverted: 0xdeadbeef secret payload"));
check("normalized message never leaks the raw payload",
  !norm.message.includes("0xdeadbeef") && !norm.technical.includes("0xdeadbeef"));
check("normalized error has a retry strategy", typeof norm.retry === "string");

// ── Statuses ──────────────────────────────────────────────────────────────────
console.log("\nStatuses:");
check("quote_expired can retry", getTradeStatusInfo("quote_expired").canRetry);
check("transaction_confirmed is terminal", getTradeStatusInfo("transaction_confirmed").terminal);
check("bridge_waiting_destination is non-terminal", !getTradeStatusInfo("bridge_waiting_destination").terminal);

// ── getsimpl-api v2 quote parser (format=v2 migration) ───────────────────────
console.log("\nv2 quote parser:");

// A v2 envelope is normalized from its inner `quote`, and top-level warnings merge in.
const v2 = parseTradeApiResponse(
  {
    version: 2,
    quote: {
      kind: "swap",
      provider: "zeroex",
      fromToken: { symbol: "USDC", amount: "1000000" },
      toToken: { symbol: "WETH", estimatedAmount: "5", minAmount: "4" },
      fees: { simplFeeBps: 50, providerFee: "10", networkFee: "20", totalFeeUsd: 1.5 },
      expiresAt: NOW + 30_000,
    },
    warnings: [{ code: "SLIPPAGE_HIGH", level: "warning", message: "high" }],
  },
  { kind: "swap", provider: "zeroex" },
);
check("v2 envelope → normalized quote", v2.provider === "zeroex" && v2.toToken.estimatedAmount === "5");
check("v2 fee breakdown preserved", v2.fees.simplFeeBps === 50 && v2.fees.totalFeeUsd === 1.5);
check("v2 envelope-level warnings merge into quote", v2.warnings.some((w) => w.code === "SLIPPAGE_HIGH"));
check("v2 quote NOT flagged legacy", v2.legacy !== true);

// A directly-normalized quote (no envelope) parses too.
const direct = parseTradeApiResponse(
  { kind: "bridge", provider: "lifi", fromToken: { symbol: "USDC" }, toToken: { symbol: "USDC" }, fees: {} },
  { kind: "bridge", provider: "lifi" },
);
check("direct normalized quote parses", direct.kind === "bridge" && direct.provider === "lifi");

// Legacy raw 0x → adapter path; simplFee is UNAVAILABLE (never assumed 0).
const legacyZx = parseTradeApiResponse(
  {
    sellToken: "0xUSDC",
    buyToken: "0xWETH",
    buyAmount: "5",
    minBuyAmount: "4",
    totalNetworkFee: "20",
    fees: { integratorFee: { amount: "10", token: "0xUSDC", type: "volume" } },
    issues: { allowance: { spender: "0xspender" } },
    transaction: { to: "0x", data: "0x" },
  },
  { kind: "swap", provider: "zeroex" },
);
check("legacy 0x adapts via fallback", legacyZx.legacy === true && legacyZx.provider === "zeroex");
check("legacy 0x maps buyAmount → estimatedAmount", legacyZx.toToken.estimatedAmount === "5");
check("legacy 0x maps totalNetworkFee → networkFee", legacyZx.fees.networkFee === "20");
check("legacy 0x maps integratorFee → providerFee", legacyZx.fees.providerFee === "10");
check("legacy 0x simplFee is UNAVAILABLE (not 0)", legacyZx.fees.simplFeeBps === undefined && legacyZx.fees.simplFeeAmount === undefined);
check("legacy 0x surfaces the approval spender", legacyZx.approval?.spender === "0xspender");
check("adaptLegacyZeroX direct call agrees", adaptLegacyZeroX({ buyAmount: "5" }).toToken.estimatedAmount === "5");

// Legacy raw LI.FI → adapter path.
const legacyLifi = parseTradeApiResponse(
  { fromChainId: 1, toChainId: 8453, fromToken: { symbol: "USDC" }, toToken: { symbol: "USDC" }, feeCostBaseUnits: "12", txRequest: { to: "0x" } },
  { kind: "bridge", provider: "lifi" },
);
check("legacy LI.FI adapts via fallback", legacyLifi.legacy === true && legacyLifi.fees.providerFee === "12");
check("adaptLegacyLifi direct call agrees", adaptLegacyLifi({ feeCostBaseUnits: "9" }).fees.providerFee === "9");

// Unknown shapes fail loudly (never silently mis-parsed).
let threw = false;
try {
  parseTradeApiResponse({ totally: "unknown" }, { kind: "swap", provider: "zeroex" });
} catch (e) {
  threw = e instanceof TradeQuoteParseError;
}
check("unknown shape throws TradeQuoteParseError", threw);

// Warning de-dup (first wins).
const a: SimplTradeWarning[] = [{ code: "X", level: "warning", message: "1" }];
const b: SimplTradeWarning[] = [{ code: "X", level: "danger", message: "2" }, { code: "Y", level: "info", message: "3" }];
const merged = mergeWarnings(a, b);
check("mergeWarnings de-dupes by code, first wins", merged.length === 2 && merged[0].message === "1");

// Confirmability mirrors the reliability layer.
check("v2 fresh quote is confirmable", isTradeQuoteConfirmable(v2, NOW));
check("expired v2 quote not confirmable", !isTradeQuoteConfirmable({ ...v2, expiresAt: NOW - 1 }, NOW));
check("blocked-warning quote not confirmable",
  !isTradeQuoteConfirmable({ ...v2, warnings: [{ code: "B", level: "blocked", message: "no" }] }, NOW));
check("isTradeQuoteExpired agrees with expiry", isTradeQuoteExpired({ expiresAt: NOW - 1 }, NOW) && !isTradeQuoteExpired({ expiresAt: NOW + 1 }, NOW));

console.log("");
if (failures > 0) {
  console.log(`SWAP/BRIDGE RELIABILITY CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("SWAP/BRIDGE RELIABILITY CHECK PASSED");
