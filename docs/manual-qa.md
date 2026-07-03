# Manual QA — Security Flows

Human verification for the security-critical flows (Stages 1–4). The automated
gate is `npm run check:release`; this covers what the gate cannot. Load the
production build (`npm run build`) unpacked from `dist/` in `chrome://extensions`.

The full pre-release list lives in `docs/release-checklist.md`; this file focuses
on the Stage 4 backup / locked-approval / watch-only scenarios.

## Backup enforcement
- [ ] Fresh install → create new wallet → after the seed screen you land in
      **verification**, not Home.
- [ ] Try to skip: only an explicit "Remind me later" proceeds (→ Home + banner);
      there is no silent skip.
- [ ] Verify backup: wrong word selection fails; correct words complete it →
      Security Center shows verified + date; Home banner disappears.
- [ ] Lock the wallet, unlock again — state persists.
- [ ] Open a dApp connect while the wallet is locked → the approval shows a
      password field / an actionable screen (not a dead-end).
- [ ] Unlock + approve → action proceeds. Unlock + reject → nothing happens.
- [ ] WalletConnect proposal while locked → approval reachable; reject/close
      creates no session.

## Risk actions (fresh unverified mnemonic)
- [ ] Send → blocked with a "back up first" screen.
- [ ] Swap → blocked / watch-only-style guard.
- [ ] Bridge → blocked.
- [ ] After verifying backup → Send/Swap/Bridge work normally.

## Watch-only
- [ ] Watch-only account: Send/Swap/Bridge show a guard, no signing UI.
- [ ] A dApp `personal_sign` / `eth_sendTransaction` targeting a watch-only
      active account is rejected with a clear error (no approval window opens).
- [ ] Receive / History / Copy address still work.

## Migrated wallet
- [ ] A wallet created before this release (no backup metadata) shows a reminder
      banner but is **not** blocked from send/swap/bridge.

## Swap / bridge (Stage 6)
- [ ] Swap quote shows: you pay / receive / minimum received / network fee /
      simpl fee (when applied) / price impact / slippage / route / quote expiry
- [ ] Quote expiry countdown → on expiry, Confirm is disabled until refresh
- [ ] High slippage (>5%) requires an explicit danger acknowledgement; >15% blocked
- [ ] High price impact (≥5%) requires ack; ≥15% blocked
- [ ] Insufficient balance / insufficient native gas → clear blocking error, no send
- [ ] Token needing approval → approval step shown before swap
- [ ] Provider unavailable / no route → normalized message + retry, not a raw error
- [ ] Pancake fallback (when 0x unavailable) shows a fallback warning; no silent fee claim
- [ ] Bridge (LI.FI): source chain / destination chain / est. time / source status /
      destination pending → confirmed; invalid destination address blocked
- [ ] Watch-only / locked / unverified-backup account cannot reach swap/bridge confirm

## Backend-authoritative fees / `?format=v2` (API v2 migration)
- [ ] Network tab: swap request carries `format=v2` and **no** `swapFeeBps` /
      `swapFeeRecipient` / `swapFeeToken` params
- [ ] Network tab: LI.FI quote (POST `/v1/bridge/lifi/quote?format=v2`) body has
      **no** `integrator` and **no** `fee`; status poll also sends `format=v2`
- [ ] simpl fee row shows the API-returned fee once the quote is ready, and "—"
      (unavailable) — never "0" — before the quote loads or when absent
- [ ] With the backend still returning the legacy shape (v2 not yet deployed),
      swap and bridge quotes still load and complete normally (legacy fallback)

## Performance / UI polish (Stage 7)
- [ ] Fresh install → unlock → **Home loads fast** (no swap/bridge/WC code on the initial path)
- [ ] Navigate to Send / Swap / Bridge / Receive / Settings / Security / Accounts /
      Activity → each lazy route loads with a brief loading state, then renders; back works
- [ ] dApp approval window renders; WalletConnect approval window renders
- [ ] A request on an unknown network shows "Unknown network (<id>)" — no crash
- [ ] Known networks show correct labels (Ethereum / BNB / Base / Sepolia / TRON / Solana / Bitcoin / TON)
- [ ] Logo renders crisply on Welcome / Unlock / header (optimized asset)
- [ ] Light + dark mode legible; popup 360×600 has no layout jumps / horizontal scroll
- [ ] Side panel opens and renders
- [ ] Offline / chunk-load failure on a lazy route → error boundary + Retry (no blank popup)

## Production build
- [ ] `npm run build` → load `dist/` unpacked → no console errors; the
      permissions shown are only the host allowlist (no "all sites"); no
      addresses / raw tx / signatures / seed in console or `chrome.storage.local`.
