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
| WalletConnect approval | `npm run check:walletconnect` | Explicit-approval model (no auto-approve, no connect-before-approve, allowlist, approve/reject clear pending) |
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
- [ ] Backup step shows the verification reminder; Security Center reports the
      seed as **not verified** until verification is completed
- [ ] Seed backup verification flow marks it verified
- [ ] Lock → unlock with password works; wrong password rejected
- [ ] Watch-only account (if used) cannot reach the signing path

### dApp (injected provider)
- [ ] Connect from a dApp → approval popup; **Approve** connects, **Reject** does not
- [ ] After connect, `personal_sign` / `eth_signTypedData_v4` open an approval; reject blocks
- [ ] `eth_sendTransaction` opens an approval with correct to/value/network
- [ ] Chain switch request → approval; account only switches after confirm
- [ ] Account switch request (`simpl_switchAccount`) → approval; no silent switch
- [ ] Revoke the site in Connected Sites → dApp can no longer sign/send until it
      reconnects (and reconnect requires approval again)

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

### Privacy / permissions (production build)
- [ ] `chrome://extensions` shows only the host allowlist — **no "all sites"**
- [ ] DevTools console + `chrome.storage.local` contain no addresses, raw tx,
      signatures, or WC proposal/request payloads
- [ ] No `nativeMessaging` prompt / permission

## 3. Do NOT auto-merge / auto-publish

Merge to `main` and Web Store submission are explicit human decisions after the
above. See `docs/security-review.md` and `docs/chrome-store-permissions.md`.
