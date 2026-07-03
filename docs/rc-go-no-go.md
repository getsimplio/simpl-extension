# Release Candidate — Go / No-Go Report

**Product:** simpl extension (Chrome, MV3)
**RC code commit:** `bb60960` (branch `feat/rc-final-qa`, stacked on Stages 6–8)
**Package:** `simpl-cws.zip` (repo root, gitignored build artifact) — **1.78 MB**
**Version:** `0.1.0` (manifest == package.json)
**Build env:** production build produced with `VITE_0X_API_KEY` unset (0x proxy-only)
**Chrome / OS:** _RC validated on host build only; browser run pending (see Manual QA)_
**QA date:** 2026-07-03

> **Honesty note:** this report was produced by an automated code session. It did
> **not** install the extension in a real Chrome profile, click approval windows,
> send testnet transactions, or capture screenshots. Every item below is marked
> **[verified via code/gate]** (statically checked here) or **[REQUIRES HUMAN RUN]**
> (must be exercised by a person in Chrome before submission). No manual result is
> fabricated.

## Automated checks (all green)

| Check | Result |
| --- | --- |
| `npm run typecheck` | ✅ pass |
| `npm run check:i18n` | ✅ pass (all locales key-complete) |
| `npm run check:release` | ✅ **18/18** (typecheck · i18n · walletconnect · permissions · risk · endpoints · proxy · trade · ui · assets · store-docs · privacy · manifest · dapp · security · build · bundle · package) |
| `npm run check:store-docs` | ✅ pass |
| production build (`build:prod`, key unset) | ✅ clean |
| `npm run package:cws` | ✅ `simpl-cws.zip` (1.78 MB) |
| `npm run check:package` | ✅ pass (no source/.env/maps/junk; no test seed/PEM; no remote code; icons+manifest+version ok) |

**Secret-inlining proof:** the 0x API key value (`.env.example` template) is **absent**
from both `dist/` and `simpl-cws.zip`; the `0x-api-key` header literal is not even
present in the key-free build; the only `sk_`-shaped matches are wasm-bindgen glue
(`__wbg_queueMicrota`**`sk_<hash>`**), not secrets.

## Static endpoint / permission verification [verified via code/gate]

- Manifest: **no `nativeMessaging`**; **no `<all_urls>` in `host_permissions`** (19
  explicit hosts == endpoint inventory); `content_scripts` scoped to `http/https`;
  CSP `script-src 'self'; object-src 'self'` (no `unsafe-eval`, no remote script).
- Supported networks == registry: Ethereum, BNB Chain, Base, TRON, Bitcoin, Solana,
  TON (mainnets) + Sepolia, Bitcoin Testnet, Solana Devnet. No others claimed.
- Custom-RPC validators block `http://` (prod) and private/internal ranges
  (`check:endpoints`).

## Manual QA matrix

| Area | Status | Basis |
| --- | --- | --- |
| Onboarding (create/import/unlock in Chrome) | **REQUIRES HUMAN RUN** | create-flow writes backup status + password policy [verified via code/`check:security`]; real create/unlock not exercised |
| Backup verification (word quiz + gate) | **REQUIRES HUMAN RUN** | gate + enforcement [verified via `check:risk` + App routing code]; quiz interaction not exercised |
| Accounts (add/import/watch/switch) | **REQUIRES HUMAN RUN** | switch-account approval + watch-only guards [verified via `check:dapp`]; UI flows not exercised |
| Networks (balances per chain) | **REQUIRES HUMAN RUN** | endpoint/host-permission coverage [verified via `check:manifest`/`check:endpoints`]; live balance loads not exercised |
| dApp connect / sign / tx (approve+reject) | **REQUIRES HUMAN RUN** | no-auto-approve, per-account/chain/method scoping, watch-only reject [verified via `check:dapp`/`check:walletconnect`]; approval-window clicks not exercised |
| WalletConnect (approve/reject/unsupported/close) | **REQUIRES HUMAN RUN** | no-auto-approve, reject/close/expiry create no session, method allowlist [verified via `check:walletconnect`]; live pairing not exercised |
| Send / Receive (testnet) | **REQUIRES HUMAN RUN** | preflight + watch-only + backup gates [verified via `check:trade`/`check:risk`]; testnet send + QR not exercised |
| Swap (quote/fee/slippage/expiry/execute) | **REQUIRES HUMAN RUN** | fee matrix, slippage/price-impact, quote expiry, preflight, 0x proxy-only [verified via `check:trade`/`check:proxy`]; live quote/execute not exercised |
| Bridge (LI.FI route/status/fee) | **REQUIRES HUMAN RUN** | LI.FI fee backend-authoritative, route/status model [verified via `check:trade`/`check:proxy`]; live bridge not exercised |
| Endpoint / permissions | **[verified via code/gate]** | manifest + inventory + custom-RPC validators all statically verified |
| UI / performance (popup 360×600, light/dark, sidepanel) | **REQUIRES HUMAN RUN** | bundle budget + lazy-route split [verified via `check:bundle` + build chunk split]; visual render/scroll/theme not exercised |
| Screenshots | **REQUIRES HUMAN RUN** | plan ready in `docs/store-assets-plan.md`; images not captured (no fabrication) |
| Store placeholders | **REQUIRES HUMAN** | see below |

## Store placeholders (require human resolution)

- `docs/privacy-policy.md` `<date>` (Last-updated) — unset.
- `support@getsimpl.io` — confirm it is a monitored inbox.
- Privacy-policy **public URL** — CWS listing field; must be hosted publicly (not in repo).
- Version `0.1.0` — confirm intended public version (bump if desired).
- `docs/store-listing.md` — replace any remaining `<placeholder>` and finalize copy.

## Blockers

**None** in the automated scope. All 18 release-gate checks pass; the RC package is
clean and secret-free.

## Near-blockers (must clear before submission)

1. Human Manual QA pass in a clean Chrome profile (the REQUIRES-HUMAN-RUN rows above).
2. Capture the screenshots per `docs/store-assets-plan.md` (test wallet, masked addresses).
3. Resolve store placeholders (date, support inbox, privacy URL, version).
4. Rebuild the official submission artifact with `VITE_0X_API_KEY` unset (verified
   key-free here; the human builder must use the same env).

## Post-release backlog

- `wallet.service.js` (~2 MB) per-network dynamic-import split.
- Wire `SwapPage`/`BridgePage`/`SolanaSwapPage` to render from `SimplQuote` + `runPreflight`.
- Custom-RPC add-network UI (validators + `optional_host_permissions` runtime request).
- getsimpl-api: confirm swap-proxy covers all production 0x usage; enforce LI.FI
  integrator/fee server-side.
- Solana off-chain metadata proxy; CI wiring of `check:release`; dead-code cleanup.

## Verdict: **CONDITIONAL GO**

The package is **technically ready**: every automated gate is green, the build is
secret-free, and all statically-verifiable security/permission/network invariants
hold. However, the critical-path **human Manual QA** (create/unlock/recover in a
real Chrome profile, dApp/WalletConnect approve-reject windows, a testnet send),
**screenshots**, and **store placeholder resolution** have **not** been performed
in this session and cannot be by an automated host session.

**Next action before CWS submission:** a person runs the REQUIRES-HUMAN-RUN Manual
QA matrix on the `simpl-cws.zip` build in a clean Chrome profile, captures the
screenshots, resolves the placeholders, and — only then — makes the final GO call
and submits. This is not an unconditional GO.
