# Release Checklist — simpl wallet

Pre-release gate for a Chrome Web Store build. This is a **P0 wallet** — nothing
ships without the automated gate green **and** the manual QA below signed off.

## 1. Automated release gate

```
npm run check:release
```

Runs, fail-fast, in order:

| Step | Command | What it protects |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Type safety |
| i18n | `npm run check:i18n` | All 8 locales key-complete |
| WalletConnect approval | `npm run check:walletconnect` | Explicit-approval model (no auto-approve, no connect-before-approve, allowlist, approve/reject clear pending, WC sessions stored/guarded as scoped permissions) |
| Permission model | `npm run check:permissions` | v1→v2 migration safety, scope predicates, grant/revoke/expiry, audit-log cap |
| Backup / risk policy | `npm run check:risk` | backup-status classification + risk-policy (watch-only, locked, unsupported chain, unverified-mnemonic) |
| Endpoint inventory | `npm run check:endpoints` | unregistered external endpoint in src; custom-RPC validators |
| Proxy / provider secrets | `npm run check:proxy` | production 0x direct/client-key; LI.FI/Jupiter proxy routing; fee matrix; 0x strips fee params + `?format=v2`; LI.FI sends no `integrator`/`fee` + `?format=v2` |
| Swap/bridge reliability | `npm run check:trade` | quote model, fee matrix, slippage/price-impact, preflight, error taxonomy, **v2 quote parser** (envelope/direct/legacy adapters, `?format=v2`) |
| UI primitives / chain labels | `npm run check:ui` | primitive variants; registry-backed, unknown-safe chain labels |
| Asset budget | `npm run check:assets` | oversized images, junk artifacts, extension icons |
| Bundle budget | `npm run check:bundle` | popup main chunk + runaway-chunk budgets (after build) |
| Privacy | `npm run check:privacy` | No raw WC payload storage, no hard-enabled debug flags, no secret logging |
| Manifest | `npm run check:manifest` | No `<all_urls>` host_permissions, no unshipped `nativeMessaging`, docs present |
| dApp permissions | `npm run check:dapp` | `simpl_switchAccount`/`switchChain` approval-gated; sensitive methods guarded; revoke works |
| Security smoke | `npm run check:security` | Password policy / auto-lock / biometric capability |
| Production build | `npm run build` | Clean `tsc` + `vite build` |

Each sub-check can also be run individually.

## 2. Manual QA (required — the gate cannot cover UX)

Load the unpacked production build from `dist/` in `chrome://extensions`.

### Fresh install & vault
- [ ] Fresh install → onboarding shows; no console errors
- [ ] Create wallet → password step enforces policy; seed shown
- [ ] After create, the wallet is routed into seed **verification**, not straight to Home
- [ ] "Remind me later" is explicit → lands on Home with a backup banner
- [ ] Cannot mark verified without selecting the correct random words
- [ ] Verification success → Security Center shows verified + date; Home banner gone
- [ ] Close the app mid-verification → next open still shows backup-required
- [ ] Fresh unverified wallet: Send is blocked (backup-required screen); swap/bridge/WC blocked
- [ ] Migrated wallet (pre-existing) → reminder banner only, Send/Swap NOT blocked
- [ ] Lock → unlock with password works; wrong password rejected
- [ ] Watch-only account cannot reach the signing path (Send/Swap/Bridge guarded)

### Locked approval & watch-only dApp
- [ ] Open a dApp connect/sign approval → password field present; approve is explicit
- [ ] No-account "locked" approval screen offers **Open wallet** (not a dead-end)
- [ ] Close an approval window → the dApp request is rejected (not left hanging)
- [ ] WalletConnect proposal window closed without acting → no session created
- [ ] Watch-only account: a dApp `personal_sign` / `eth_sendTransaction` is rejected
      with a clear error (no pointless approval opens)

### dApp (injected provider)
- [ ] Connect from a dApp → approval popup; **Approve** connects, **Reject** does not
- [ ] `eth_accounts` returns only the granted account(s), not the whole wallet
- [ ] After connect, `personal_sign` / `eth_signTypedData_v4` open an approval; reject blocks
- [ ] `eth_sendTransaction` opens an approval with correct to/value/network
- [ ] Chain switch request → approval; account only switches after confirm
- [ ] Account switch request (`simpl_switchAccount`) → approval; no silent switch
- [ ] Revoke the site in Connected Sites → dApp can no longer sign/send until it
      reconnects (and reconnect requires approval again)

### Connected Sites & permissions
- [ ] Existing (pre-upgrade) sites show with **no permissions**; first
      `eth_requestAccounts` re-prompts a scoped connect (v1→v2 migration)
- [ ] Each site shows source (Browser dApp / WalletConnect), accounts, networks,
      permissions (grouped), last used, and expiry (WC)
- [ ] Details expands the full account/network/permission breakdown + risk note
- [ ] Revoke all disconnects every site (incl. live WalletConnect sessions)

### WalletConnect
- [ ] Pair via URI → approval window shows peer name/url + requested chains/methods
- [ ] **Approve** → session active + site listed in Connected Sites
- [ ] **Reject** → no session, not listed
- [ ] Close the approval window without acting → no session created
- [ ] dApp requiring an unsupported method (e.g. `eth_sign`) → rejected before Approve
- [ ] Sign message / send tx over WC → approval + password; result returned to dApp

### Networks
- [ ] Balances load on ETH / BSC / Base / Sepolia / TRON / BTC / Solana / TON
      (confirms the narrowed `host_permissions` covers every RPC)
- [ ] Swap (0x) and Bridge (LI.FI via `api.getsimpl.io`) complete
- [ ] Token logos render (Trust Wallet / 1inch / IPFS)
- [ ] A Solana token whose metadata is on an arbitrary https host → no crash
      (logo/name enrichment may be skipped — see `docs/endpoint-inventory.md`)

### Network / endpoints / proxy (Stage 5)
- [ ] dApp connect works on a normal site → provider injects (content_scripts `<all_urls>`/http-https)
- [ ] Extension does NOT request `<all_urls>` in host_permissions (CWS review)
- [ ] Swap quote loads via the production Simpl proxy (network tab shows `api.getsimpl.io`, not `api.0x.org`)
- [ ] Bridge quote loads via the proxy; Solana swap via the proxy
- [ ] Price + balance loading works (EVM / Solana / TRON / Bitcoin history)
- [ ] WalletConnect connect works
- [ ] (When an add-RPC UI exists) add custom RPC → risk panel + permission prompt;
      deny → not saved; remove → reverts to default RPC; http/private hosts rejected

### Privacy / permissions (production build)
- [ ] `chrome://extensions` shows only the host allowlist — **no "all sites"**
- [ ] DevTools console + `chrome.storage.local` contain no addresses, raw tx,
      signatures, or WC proposal/request payloads
- [ ] No `nativeMessaging` prompt / permission

## 3. CWS submission readiness (Stage 8)

### Code readiness
- [ ] `npm run typecheck`, `npm run check:i18n`, `npm run check:release` all green
- [ ] Production build clean (`npm run build`)

### Security readiness
- [ ] WalletConnect explicit approval (no auto-approve); dApp connect/sign/tx approvals
- [ ] Connected-site revoke removes access (per-site + WC session)
- [ ] Seed backup enforcement (fresh mnemonic gated; migrated warned)
- [ ] No sensitive logs in production (`npm run check:privacy`)
- [ ] Endpoint inventory current; `host_permissions` == inventory (`npm run check:manifest`)

### Store readiness
- [ ] Manifest permissions justified (`docs/chrome-store-permissions.md`); no `nativeMessaging`; no `<all_urls>` host_permissions
- [ ] Privacy policy published (`docs/privacy-policy.md`) and matches code
- [ ] Listing copy finalized (`docs/store-listing.md`) — networks == registry, no overclaim
- [ ] Screenshots captured per `docs/store-assets-plan.md` (test wallet, no seed/keys)
- [ ] Reviewer notes ready (`docs/chrome-store-reviewer-notes.md`)
- [ ] Package validated: `npm run check:store-docs`, `npm run check:package`, `npm run package:cws`
- [ ] **Production build built WITHOUT `VITE_0X_API_KEY`** (proxy-only) so no provider key is inlined into the bundle

### Manual QA (final pass — see `docs/manual-qa.md`)
- [ ] Clean install · create wallet · backup verification · lock/unlock
- [ ] Receive · send on testnet · dApp connect approve/reject · sign approve/reject
- [ ] WalletConnect approve/reject · connected-sites revoke · swap quote · bridge quote
- [ ] Custom RPC add/remove (when UI exists) · light/dark · popup 360×600 · side panel

### Rollback plan
- [ ] Keep the previous published version available to re-submit
- [ ] Risky providers (0x/LI.FI/Jupiter routes) can be disabled via the Simpl API
      gateway / env config without a client release
- [ ] Hotfix path: patch on a branch → `check:release` → new CWS version

### Post-release monitoring
- [ ] Watch user reports / CWS reviews and crash/error signals
- [ ] Monitor provider/RPC availability (swap/bridge/price gateway)
- [ ] Track approval/permission complaints and revoke behavior

## 4. Do NOT auto-merge / auto-publish

Merge to `main` and Web Store submission are explicit human decisions after the
above. See `docs/security-review.md` and `docs/chrome-store-permissions.md`.
