# Swap / Bridge Reliability

Stage 6. The normalized trade model, slippage/price-impact policy, preflight,
failure states and error taxonomy that every swap/bridge provider funnels
through. Source of truth (code): `src/core/trade/*` (pure). Seeds, private keys,
signatures and raw-tx payloads are never logged or sent to a non-RPC endpoint.

## Normalized quote model (`quote-model.ts`)

Every provider (0x, Pancake, Jupiter, LI.FI, custom) normalizes into one
`SimplQuote`: `fromToken`/`toToken` (with `estimatedAmount` + `minAmount`),
`fees {networkFee, providerFee, simplFee, totalFeeUsd}`, `priceImpact`,
`slippageBps`, `expiresAt`, `route[]`, `warnings[]`, and `simulation.status`
(`not_required | passed | failed | unavailable`). Unknown values are explicit
("unavailable"), never fabricated. Helpers: `isQuoteExpired`,
`computeMinReceived`, `isQuoteConfirmable`, `highestWarningLevel`.

## Provider matrix

| Provider | Kind | Fee enforcement | Production route | Notes |
| --- | --- | --- | --- | --- |
| 0x | swap | provider-enforced (`swapFeeBps`) | via Simpl proxy | direct call blocked in prod (Stage 5) |
| LI.FI | bridge | backend-authoritative | via getsimpl gateway | client fee is a hint only |
| Jupiter | swap | backend-authoritative | via getsimpl gateway | quote returns `actualFeeBps` |
| Pancake V2 | swap | **none (fallback)** | fallback only | must warn, never a silent monetized route |

See `docs/fee-enforcement-matrix.md`.

## Slippage policy (`slippage-policy.ts`)

Defaults: stable `0.1%`, standard `0.5%`, volatile `1%`. `HARD_MAX = 5%` (above
requires an explicit danger acknowledgement); `ABSOLUTE_MAX = 15%` (never
exceeded — the old Pancake 50% clamp is gone). `evaluateSlippage()` →
`{allowed, level, effectiveSlippageBps, requiresAcknowledgement}`.

## Price impact

`evaluatePriceImpact()`: `<1%` info, `≥1%` warning, `≥5%` danger (ack required),
`≥15%` blocked. Unknown impact → surfaced as "unavailable", not blocked.

## Quote expiry & minimum received

Every quote carries `expiresAt`; an expired quote disables Confirm and the UI
must refresh. `minAmount` (minimum received) is always shown; when a provider
omits it, `computeMinReceived(estimated, slippageBps)` derives it.

## Simulation

`simulation.status`: `passed` → ok; `failed` → **blocks** confirm; `unavailable`
→ warning (proceed with caution); `not_required` → silent.

## Preflight (`preflight.ts`)

`runPreflight(ctx)` aggregates every gate into `{ok, blockingErrors, warnings}`:
wallet unlocked · not watch-only · risk policy passed (backup) · correct chain ·
balance · native gas · allowance (approval = warning, not block) · quote not
expired · slippage · price impact · simulation · bridge destination
address/chain. Confirm is enabled only when `ok` and all danger acks are given.

## Failure states (`trade-status.ts`)

Canonical statuses with user copy + retry + terminal flag:
`quote_loading | quote_ready | quote_expired | simulation_unavailable |
simulation_failed | approval_required | approval_pending | approval_failed |
confirm_ready | transaction_pending | transaction_submitted |
transaction_confirmed | transaction_failed | bridge_waiting_source |
bridge_waiting_destination | bridge_refund_required | bridge_stuck |
route_unavailable`. The UI maps to these — never raw provider states.

## Error taxonomy (`trade-errors.ts`)

Raw provider errors → stable `TradeErrorCode` (see
`docs/trade-error-taxonomy.md`) via `classifyTradeError` / `normalizeTradeError`.
Normalized messages are safe and never include raw tx / signatures / API keys;
`technical` is a sanitized code for support.

## Confirmation screen (target)

You pay · You receive (estimated) · Minimum received · Network fee · Provider fee
· simpl fee (only if applied) · Price impact · Slippage · Route · Quote expires
in · Simulation status · Warnings · Approval step (if needed) · Confirm. Bridge
adds: source chain · destination chain · estimated time · source/destination
status · refund/stuck info.

## Integration status / follow-up (Stage 7)

The model + policies + preflight + error taxonomy are implemented and unit-tested
(`npm run check:trade`), and the Pancake slippage cap now uses the shared policy.
Wiring `SwapPage`/`BridgePage`/`SolanaSwapPage` to render exclusively from
`SimplQuote` + `runPreflight` (replacing their per-provider ad-hoc rendering) is
the remaining integration step, kept out of this change to avoid destabilizing
the working swap/bridge flows.

**getsimpl-api follow-ups:** confirm the swap proxy covers all production 0x
usage; enforce the LI.FI integrator/fee server-side (client params may be
stripped) — these are backend-authoritative and must not be client-side
partial-fixed.

## Consuming getsimpl-api v2 (`?format=v2`)

`src/core/trade/quote-response.ts` is the single normalizer for trade responses.
`parseTradeApiResponse(payload, {kind, provider})` returns one `SimplTradeQuote`
(fees, approval, route, tx, expiry, warnings) from whichever shape the gateway
returns:

1. **v2 envelope** — `{version: 2, quote}` (or `data`); envelope-level warnings
   merge into the quote (`mergeWarnings`, de-dup by code).
2. **direct normalized quote** — the v2 shape returned without the envelope.
3. **legacy raw provider shape** — `adaptLegacyZeroX` / `adaptLegacyLifi`. This
   is a **required fallback**: getsimpl-api v2 is **not yet deployed to
   production**, so `?format=v2` is currently ignored by the backend and the old
   shape is returned. The extension must keep working on both. Legacy-marker
   fields (`buyAmount`/`transaction` for 0x, `feeCostBaseUnits`/`txRequest` for
   LI.FI) are checked *before* the normalized heuristic because they are disjoint
   from the v2 field names, so a real v2 quote is never mis-adapted.

Unknown shapes raise `TradeQuoteParseError` (never silently mis-parsed; raw
provider errors are never surfaced verbatim). Accessors: `toSimplSwapQuote`
(zeroXSwapService) and `toSimplBridgeQuote` (lifi-bridge.service).

Fees are **backend-authoritative**: the extension sends no fee params (see
`docs/fee-enforcement-matrix.md` → "Backend-authoritative migration") and only
displays what the gateway returns; a missing fee is "unavailable", never 0.

**Follow-up (separate PR):** remove the legacy adapters once v2 is the only
production shape, and add `normalizeJupiterQuote` for the Solana swap path.

## Enforced by

`scripts/check-trade.ts` (`npm run check:trade`) — quote model, fee matrix,
slippage/preflight/errors, **and the v2 parser smoke** (envelope, direct,
legacy 0x/LI.FI adapters, unknown→error, warning de-dup, confirmability) — plus
`check:proxy` (asserts 0x strips fee params + sends `format=v2`; LI.FI sends no
`integrator`/`fee` and requests `format=v2`). Both part of `npm run check:release`.
