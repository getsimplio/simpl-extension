# Fee Enforcement Matrix

Where and how the simpl swap/bridge fee is enforced per provider. Source of
truth (code): `src/core/trade/fee-policy.ts`. Principle: **in production a fee
must never depend on client-only logic** where it affects monetization or
compliance — it is enforced by the provider or the Simpl backend.

## Fee bounds

`SIMPL_FEE_DEFAULT_BPS = 50` (0.5%), `MIN = 0`, `MAX = 100` (1%). A configured
`VITE_SIMPLE_SWAP_FEE_BPS` outside `[0, 100]` is rejected by `isSimplFeeBpsValid`.

## Matrix

| Provider | Kind | Default | Max | Enforcement | Requires proxy | Prod | If not enforceable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x | swap | 50 bps | 100 | `provider_enforced` (`swapFeeBps`) | yes | ✅ | n/a (0x collects it) |
| LI.FI | bridge | 50 bps | 100 | `backend_authoritative` | yes | ✅ | gateway enforces; client fee is display/hint only |
| Jupiter | swap | 50 bps | 100 | `backend_authoritative` | yes | ✅ | gateway applies `platformFeeBps` |
| Pancake V2 | swap | 0 | 0 | `unsupported` | no | fallback | **no fee; must warn, not silent** |

## Enforcement modes

- **`provider_enforced`** — the provider collects the fee from a signed request
  param it honours (0x `swapFeeBps`). Not tamperable post-quote.
- **`backend_authoritative`** — the getsimpl-api gateway injects/enforces the fee
  server-side (LI.FI integrator+fee, Jupiter platform fee) and may strip client
  fee params. The client value is a request hint, never authoritative.
- **`client_display_only`** — a client can only *display* a fee. Not permitted as
  a monetized production route (none used today).
- **`unsupported`** — no fee mechanism (Pancake V2 fallback).

## Rules enforced

1. Production 0x never calls `api.0x.org` directly nor uses `VITE_0X_API_KEY` as
   a production secret (`getZeroXBaseUrl()` throws in a prod build without the
   proxy — Stage 5) → `check:proxy`.
2. LI.FI fee is **not** client-authoritative (`enforcement: backend_authoritative`)
   → `check:proxy` + `check:trade`.
3. Pancake fallback carries **no** simpl fee and `feeIsProductionSafe()` is
   `false` for it → it must surface a fallback warning and must not imply a
   monetized route.
4. The UI shows the simpl fee **separately** only when it is actually applied; a
   route with no fee never claims one; an unknown fee is shown as "unavailable",
   not hidden.

## getsimpl-api follow-ups (backend)

- Verify the swap proxy route covers **all** production 0x usage.
- Enforce the LI.FI integrator + fee server-side (do not rely on the client
  `VITE_LIFI_FEE` if the gateway whitelists/strips request fields).

These are backend-authoritative concerns; the client must not partial-fix them.

## Backend-authoritative migration (`?format=v2`)

As of the `feat/consume-api-v2-quotes` change the extension no longer sends any
fee-override params on a trade request. Concretely:

- **0x** — `getZeroXSwapPrice` / `getZeroXSwapQuote` call `stripClientFeeParams()`
  (deletes `swapFeeRecipient` / `swapFeeBps` / `swapFeeToken`) and append
  `format=v2`. `GetZeroXSwapQuoteParams` no longer carries `swapFee*` fields and
  `SwapPage` no longer passes them. The client-side `getSimpleSwapFeeBps()` and
  `VITE_SIMPLE_SWAP_FEE_RECIPIENT` were removed.
- **LI.FI** — the quote request body no longer includes `integrator` or `fee`;
  the gateway injects both server-side. The quote and status calls append
  `format=v2`. The `VITE_LIFI_FEE` / `VITE_LIFI_INTEGRATOR` client overrides were
  removed.

The row enforcement values in the matrix above are unchanged — they describe
*where the fee is enforced* (0x still collects it; the gateway still injects the
LI.FI/Jupiter fee). What changed is that the **client no longer supplies the fee
figure at all** — it only *displays* the breakdown returned by getsimpl-api.

### Response consumption + display

`src/core/trade/quote-response.ts` (`parseTradeApiResponse`) normalizes any
getsimpl-api trade response into one `SimplTradeQuote`. It accepts, in order: a
v2 envelope (`{version: 2, quote}`), a direct normalized quote, or — as a
**required temporary fallback while v2 is not yet deployed** — the legacy raw 0x
/ LI.FI shape (`adaptLegacyZeroX` / `adaptLegacyLifi`). The legacy adapters carry
no simpl fee, so `simplFee` is surfaced as **unavailable ("—"), never 0**. The
swap fee row renders the API-returned fee (`price.fees.integratorFee`) and falls
back to "—" until a quote loads or when the breakdown is absent.

**Follow-up (separate PR):** remove the legacy adapters once `?format=v2` is the
only shape returned in production, and add `normalizeJupiterQuote` for the
Solana swap path (currently a TODO; Jupiter still uses its own accessor).
