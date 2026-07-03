// src/core/trade/quote-response.ts
//
// Consumes getsimpl-api v2 trade responses for 0x (swap) and LI.FI (bridge) and
// normalizes them into one SimplTradeQuote the UI reads. Pure.
//
// IMPORTANT — sequencing: getsimpl-api v2 (?format=v2) is NOT yet deployed to
// production, so the legacy adapters below are a REQUIRED fallback. The parser
// accepts, in order: a v2 envelope, a direct normalized quote, or a legacy raw
// provider shape. Unknown shapes raise a clear error. Raw provider errors are
// never surfaced verbatim.
//
// Fees are BACKEND-AUTHORITATIVE. The extension only displays what getsimpl-api
// returns; it never overrides fee bps or the fee recipient client-side. When a
// fee is not returned it is "unavailable", never assumed to be 0.

import type { TradeKind, TradeProvider, WarningLevel } from "./quote-model";

export type SimplTradeFees = {
  simplFeeBps?: number;
  simplFeeAmount?: string;
  providerFee?: string;
  networkFee?: string;
  totalFeeUsd?: number;
};

export type SimplTradeApproval = {
  required: boolean;
  spender?: string;
  allowanceTarget?: string;
  currentAllowance?: string;
};

export type SimplTradeTokenIn = { address?: string; symbol?: string; decimals?: number; amount?: string };
export type SimplTradeTokenOut = SimplTradeTokenIn & { estimatedAmount?: string; minAmount?: string };

export type SimplTradeWarning = { code: string; level: WarningLevel; message: string };

export type SimplTradeRouteStep = {
  provider?: string;
  action?: string;
  fromChainId?: number;
  toChainId?: number;
  label?: string;
};

export type SimplTradeQuote = {
  id?: string;
  kind: TradeKind;
  provider: TradeProvider;
  fromChainId?: number;
  toChainId?: number;
  fromToken: SimplTradeTokenIn;
  toToken: SimplTradeTokenOut;
  fees: SimplTradeFees;
  approval?: SimplTradeApproval;
  route?: SimplTradeRouteStep[];
  tx?: unknown;
  expiresAt?: number;
  estimatedDurationSec?: number;
  status?: string;
  warnings: SimplTradeWarning[];
  // Marks a quote produced by the legacy adapter (v2 not yet returned) — useful
  // for dev diagnostics; never shown to the user.
  legacy?: boolean;
};

export type TradeApiV2Envelope = {
  version: 2;
  quote?: unknown;
  data?: unknown;
  warnings?: unknown;
  legacy?: unknown;
};

// ── query helpers ────────────────────────────────────────────────────────────

// Append format=v2 without duplicating it or clobbering existing params.
export function withFormatV2(params: URLSearchParams): URLSearchParams {
  if (params.get("format") !== "v2") params.set("format", "v2");
  return params;
}

export function formatV2Query(): string {
  return "format=v2";
}

// ── small coercers ───────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function numOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function levelOf(v: unknown): WarningLevel {
  return v === "warning" || v === "danger" || v === "blocked" ? v : "info";
}

function normalizeWarnings(v: unknown): SimplTradeWarning[] {
  if (!Array.isArray(v)) return [];
  const out: SimplTradeWarning[] = [];
  for (const w of v) {
    const r = asRecord(w);
    const message = str(r.message);
    if (!message && !str(r.code)) continue;
    out.push({ code: str(r.code) ?? "warning", level: levelOf(r.level), message: message ?? "" });
  }
  return out;
}

// Merge two warning lists, de-duplicating by code (first wins).
export function mergeWarnings(a: SimplTradeWarning[], b: SimplTradeWarning[]): SimplTradeWarning[] {
  const seen = new Set<string>();
  const out: SimplTradeWarning[] = [];
  for (const w of [...a, ...b]) {
    if (seen.has(w.code)) continue;
    seen.add(w.code);
    out.push(w);
  }
  return out;
}

function normalizeTokenIn(v: unknown): SimplTradeTokenIn {
  const r = asRecord(v);
  return {
    ...(str(r.address) ? { address: str(r.address) } : {}),
    ...(str(r.symbol) ? { symbol: str(r.symbol) } : {}),
    ...(numOf(r.decimals) !== undefined ? { decimals: numOf(r.decimals) } : {}),
    ...(str(r.amount) ? { amount: str(r.amount) } : {}),
  };
}
function normalizeTokenOut(v: unknown): SimplTradeTokenOut {
  const r = asRecord(v);
  return {
    ...normalizeTokenIn(v),
    ...(str(r.estimatedAmount) ? { estimatedAmount: str(r.estimatedAmount) } : {}),
    ...(str(r.minAmount) ? { minAmount: str(r.minAmount) } : {}),
  };
}
function normalizeFees(v: unknown): SimplTradeFees {
  const r = asRecord(v);
  return {
    ...(numOf(r.simplFeeBps) !== undefined ? { simplFeeBps: numOf(r.simplFeeBps) } : {}),
    ...(str(r.simplFeeAmount) ? { simplFeeAmount: str(r.simplFeeAmount) } : {}),
    ...(str(r.providerFee) ? { providerFee: str(r.providerFee) } : {}),
    ...(str(r.networkFee) ? { networkFee: str(r.networkFee) } : {}),
    ...(numOf(r.totalFeeUsd) !== undefined ? { totalFeeUsd: numOf(r.totalFeeUsd) } : {}),
  };
}
function normalizeApproval(v: unknown): SimplTradeApproval | undefined {
  const r = asRecord(v);
  if (Object.keys(r).length === 0) return undefined;
  return {
    required: r.required === true,
    ...(str(r.spender) ? { spender: str(r.spender) } : {}),
    ...(str(r.allowanceTarget) ? { allowanceTarget: str(r.allowanceTarget) } : {}),
    ...(str(r.currentAllowance) ? { currentAllowance: str(r.currentAllowance) } : {}),
  };
}

// A payload "looks normalized" when it carries the normalized token shape.
function looksNormalized(payload: Record<string, unknown>): boolean {
  return (
    ("fromToken" in payload && "toToken" in payload) ||
    ("fees" in payload && ("kind" in payload || "provider" in payload))
  );
}

function normalizeDirect(
  q: Record<string, unknown>,
  ctx: { kind: TradeKind; provider: TradeProvider },
  extraWarnings: SimplTradeWarning[] = [],
): SimplTradeQuote {
  return {
    ...(str(q.id) ? { id: str(q.id) } : {}),
    kind: q.kind === "bridge" || q.kind === "swap" ? (q.kind as TradeKind) : ctx.kind,
    provider: (str(q.provider) as TradeProvider) ?? ctx.provider,
    ...(numOf(q.fromChainId) !== undefined ? { fromChainId: numOf(q.fromChainId) } : {}),
    ...(numOf(q.toChainId) !== undefined ? { toChainId: numOf(q.toChainId) } : {}),
    fromToken: normalizeTokenIn(q.fromToken),
    toToken: normalizeTokenOut(q.toToken),
    fees: normalizeFees(q.fees),
    ...(normalizeApproval(q.approval) ? { approval: normalizeApproval(q.approval) } : {}),
    ...(Array.isArray(q.route) ? { route: q.route as SimplTradeRouteStep[] } : {}),
    ...(q.tx !== undefined ? { tx: q.tx } : {}),
    ...(numOf(q.expiresAt) !== undefined ? { expiresAt: numOf(q.expiresAt) } : {}),
    ...(numOf(q.estimatedDurationSec) !== undefined ? { estimatedDurationSec: numOf(q.estimatedDurationSec) } : {}),
    ...(str(q.status) ? { status: str(q.status) } : {}),
    warnings: mergeWarnings(normalizeWarnings(q.warnings), extraWarnings),
  };
}

// ── legacy adapters (temporary — remove once v2 is the only shape) ───────────

// Legacy raw 0x price/quote → SimplTradeQuote. No simpl fee is present (the
// extension no longer sends swapFeeBps), so simplFee stays undefined ("unavailable").
export function adaptLegacyZeroX(raw: Record<string, unknown>): SimplTradeQuote {
  const fees = asRecord(raw.fees);
  const issues = asRecord(raw.issues);
  const allowance = asRecord(issues.allowance);
  const integrator = asRecord(fees.integratorFee);
  const spender = str(allowance.spender) ?? str(raw.allowanceTarget);
  return {
    kind: "swap",
    provider: "zeroex",
    fromToken: { ...(str(raw.sellToken) ? { address: str(raw.sellToken) } : {}), ...(str(raw.sellAmount) ? { amount: str(raw.sellAmount) } : {}) },
    toToken: {
      ...(str(raw.buyToken) ? { address: str(raw.buyToken) } : {}),
      ...(str(raw.buyAmount) ? { estimatedAmount: str(raw.buyAmount), amount: str(raw.buyAmount) } : {}),
      ...(str(raw.minBuyAmount) ? { minAmount: str(raw.minBuyAmount) } : {}),
    },
    fees: {
      ...(str(raw.totalNetworkFee) ? { networkFee: str(raw.totalNetworkFee) } : {}),
      ...(str(integrator.amount) ? { providerFee: str(integrator.amount) } : {}),
      // simplFee intentionally omitted — backend-authoritative, not in legacy shape.
    },
    ...(spender ? { approval: { required: Boolean(str(allowance.spender)), spender } } : {}),
    ...(raw.transaction !== undefined ? { tx: raw.transaction } : {}),
    warnings: [],
    legacy: true,
  };
}

// Legacy raw LI.FI (getsimpl-normalized) bridge quote → SimplTradeQuote.
export function adaptLegacyLifi(raw: Record<string, unknown>): SimplTradeQuote {
  return {
    kind: "bridge",
    provider: "lifi",
    ...(numOf(raw.fromChainId) !== undefined ? { fromChainId: numOf(raw.fromChainId) } : {}),
    ...(numOf(raw.toChainId) !== undefined ? { toChainId: numOf(raw.toChainId) } : {}),
    fromToken: normalizeTokenIn(raw.fromToken),
    toToken: normalizeTokenOut(raw.toToken),
    fees: {
      ...(str(raw.feeCostBaseUnits) ? { providerFee: str(raw.feeCostBaseUnits) } : {}),
    },
    ...(raw.txRequest !== undefined ? { tx: raw.txRequest } : {}),
    ...(numOf(raw.estimatedDurationSec) !== undefined ? { estimatedDurationSec: numOf(raw.estimatedDurationSec) } : {}),
    ...(str(raw.status) ? { status: str(raw.status) } : {}),
    warnings: [],
    legacy: true,
  };
}

export class TradeQuoteParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeQuoteParseError";
  }
}

// Parse any getsimpl-api trade response into a SimplTradeQuote.
export function parseTradeApiResponse(
  payload: unknown,
  ctx: { kind: TradeKind; provider: TradeProvider },
): SimplTradeQuote {
  const root = asRecord(payload);

  // 1. v2 envelope.
  if (root.version === 2) {
    const inner = root.quote ?? root.data;
    if (inner && typeof inner === "object") {
      return normalizeDirect(asRecord(inner), ctx, normalizeWarnings(root.warnings));
    }
    throw new TradeQuoteParseError("v2 response envelope has no quote.");
  }

  // 2. Legacy raw provider shape (temporary fallback). Checked BEFORE the
  // normalized heuristic: legacy payloads carry fromToken/toToken too, but their
  // fee/tx markers (buyAmount/transaction, feeCostBaseUnits/txRequest) are
  // disjoint from the v2-normalized field names (estimatedAmount, fees, tx), so a
  // real v2 quote never trips this branch while a legacy one is adapted correctly.
  if (ctx.provider === "zeroex" && ("buyAmount" in root || "liquidityAvailable" in root || "transaction" in root)) {
    return adaptLegacyZeroX(root);
  }
  if (ctx.provider === "lifi" && ("feeCostBaseUnits" in root || "txRequest" in root)) {
    return adaptLegacyLifi(root);
  }

  // 3. Direct normalized quote (v2 shape returned without the envelope).
  if (looksNormalized(root)) {
    return normalizeDirect(root, ctx);
  }

  throw new TradeQuoteParseError("Unrecognized trade quote response shape.");
}

// ── confirmability helpers (mirror quote-model semantics) ────────────────────

export function isTradeQuoteExpired(q: Pick<SimplTradeQuote, "expiresAt">, nowMs: number): boolean {
  return typeof q.expiresAt === "number" && Number.isFinite(q.expiresAt) && nowMs >= q.expiresAt;
}

export function isTradeQuoteConfirmable(q: SimplTradeQuote, nowMs: number): boolean {
  if (isTradeQuoteExpired(q, nowMs)) return false;
  return !q.warnings.some((w) => w.level === "blocked");
}
