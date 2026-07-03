# Security Review — simpl wallet

Scope: pre-publication review for Chrome Web Store + public GitHub. This records
what was checked, what was fixed in the `chore/cws-public-ready` branch, and what
remains as a manual decision. It is not a substitute for a professional audit.

## Method

Static review of `public/manifest.json`, build config, and `src/`. Pattern scans
for secrets, sensitive logging, remote code, and unsafe DOM/clipboard usage.

## Findings & status

### FIXED in this branch

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | **High** | A 64-hex string (looked like a private key / hash) was committed in `readme.md` (line 108). | `readme.md` replaced with a proper `README.md`; the string removed. **Rotate/abandon any wallet or key it corresponds to** (see manual actions). |
| 2 | Medium | `public/.DS_Store` and two `public/manifest.json.bak-*` files were being copied verbatim into `dist/` by Vite, so they would ship inside the store zip. | Removed from `public/`. |
| 3 | Medium | Dev-only `http://localhost:8787/*` and `http://127.0.0.1:8787/*` host permissions in the production manifest. | Removed from `public/manifest.json`. |
| 4 | Low | Compiled native binary `native/macos/build/local-evm-wallet-keychain-host` tracked in git. | Untracked + gitignored (`native/macos/build/`). Swift source kept. |
| 5 | Low | Stray junk tracked: empty `=` file, `simpl-dapp-test.html` dev page. | Removed from git. |
| 6 | Low | `.gitignore` did not cover `.dev.vars`, zips, build dir, common caches. | Added. |

### NOT a vulnerability (verified safe)

- **Test mnemonics in `scripts/`** (`abandon … about`, `test … junk`) are the
  canonical **public BIP-39 test vectors**, used only in local dev/verification
  scripts. They control no real funds. Left in place.
- **`proxy/zero-x-proxy`** reads `ZEROX_API_KEY` from a Cloudflare env var; no
  key is hardcoded. `wrangler.toml` contains only a fee bps and the allowed
  extension origin.
- **No secrets in source:** no hardcoded private keys, API keys, bearer tokens,
  or passwords found in `src/` or `scripts/`.
- **No sensitive logging:** no `console.*` call logs seed phrases, mnemonics,
  private keys, passwords, vault keys, raw transactions, or signatures.
- **No remote code execution in the shipped extension:** no `eval`,
  `new Function`, dynamic script injection, or remote/CDN imports in any of the
  built entry points (popup, side panel, service worker, content, inpage,
  approval pages). CSP is MV3-safe: `script-src 'self'; object-src 'self'` — no
  `unsafe-eval`, no remote script sources, so even if a remote import existed it
  would be blocked at runtime.
- **Remote `<script src>` exists only in non-shipped design mockups:**
  `src/design-system/ui_kits/**` and `src/design-system/preview/**` HTML files
  load `unpkg.com` (lucide, React UMD, babel/standalone). These are **not** Vite
  inputs (`vite.config.ts`), so they are never bundled into `dist/` and never
  reach users. They are static design references only. Optional: prune or move
  them out of `src/` before going public to avoid confusing reviewers. They
  pose no CSP/runtime risk to the extension.
- **No analytics/telemetry/error-reporting SDKs** (no Sentry, GA, Amplitude,
  etc.).
- **Approval flow:** every dApp connection and signature opens a dedicated
  approval window (`chrome.windows.create` for `dappApproval` /
  WalletConnect approval) — no auto-signing. WalletConnect **session proposals**
  are also explicit-approval as of `feat/wc-explicit-approval-security` (see the
  dedicated section below); they were previously auto-approved.

### OPEN — manual decision required (not changed automatically)

| # | Severity | Item | Why deferred |
| --- | --- | --- | --- |
| A | **High (action)** | Rotate any key/wallet linked to the hex string previously in `readme.md`. | Cannot be done from the repo; the string is also in **git history** (see below). |
| B | Medium | Real `VITE_WALLETCONNECT_PROJECT_ID` value sits in the local (gitignored) `.env.local`. WC project ids are low-sensitivity (they ship in client bundles) but consider rotating before public launch. | Owner decision. |
| C | ~~Medium~~ **RESOLVED** | ~~`<all_urls>` in `host_permissions` is load-bearing~~ | **Fixed in `feat/wc-explicit-approval-security`:** `<all_urls>` removed; replaced with an explicit host allowlist + `optional_host_permissions`. Full inventory in `docs/endpoint-inventory.md`; enforced by `scripts/check-manifest.ts`. |
| D | ~~Medium~~ **RESOLVED** | ~~`nativeMessaging` needs a macOS native host~~ | **Fixed:** `nativeMessaging` removed (no native host is shipped; no code uses it). Enforced by `scripts/check-manifest.ts`. |
| E | Low | Confirm `dangerouslySetInnerHTML` usage (if any) renders only trusted/sanitized content. | Quick manual grep before publish — see command in checklist. |
| F | Low | Confirm watch-only accounts cannot reach the signing path. | Existing behavior; re-verify with a watch-only account during QA. |

## WalletConnect explicit approval + release gate (`feat/wc-explicit-approval-security`)

P0 fix + hardening, with automated regression coverage:

- **WalletConnect explicit approval:** session proposals are no longer
  auto-approved. The offscreen engine validates required chains/methods,
  persists a **sanitized** pending proposal (no raw payload), and opens the
  approval window; a session + connected site are created only after an explicit
  user Approve. Reject / window-close / expiry create nothing.
- **Method allowlist:** advertised EVM methods reduced to those with a handler +
  approval UX (`eth_sign`, `eth_signTypedData(_v3)`, `wallet_addEthereumChain`,
  EIP-5792 calls excluded).
- **Privacy:** all raw/debug WalletConnect storage writes removed; balance
  diagnostics gated to dev builds.
- **dApp:** `simpl_switchAccount` / `simpl_switchChain` can no longer change
  wallet-global state silently — both route through the approval popup.
- **Manifest:** `<all_urls>` and `nativeMessaging` removed (items C/D above).

### Automated release gate — `npm run check:release`

Runs: `typecheck` · `check:i18n` · `check:walletconnect` · `check:privacy` ·
`check:manifest` · `check:dapp` · `check:security` · production `build`. Each
sub-check fails the gate (exit 1) on regression:

| Check | Guards against |
| --- | --- |
| `check:walletconnect` | WC auto-approve; connectedSites written before approve; unsupported required method/chain; unfiltered optional methods; approve/reject not clearing pending |
| `check:privacy` | raw WC proposal/request payload storage keys; `*_DEBUG = true`; secrets in `console.*` |
| `check:manifest` | `<all_urls>` in `host_permissions`; missing/dead hosts; `nativeMessaging` without a host; missing permission/endpoint docs |
| `check:dapp` | `simpl_switchAccount`/`simpl_switchChain` bypassing approval; sensitive methods without a connection guard; revoke not removing access |

## ⚠️ Git history note (important)

Removing the leaked hex string and junk files in a new commit does **not** erase
them from history — they remain reachable in earlier commits. Before making the
repo public you must either:

- start the public repo from a **fresh history** (squash to a single initial
  commit, or push only a clean `git checkout --orphan` snapshot), **or**
- rewrite history with `git filter-repo` to purge `readme.md`'s old contents,
  `native/macos/build/`, and any `.env*` that was ever committed.

Then **force-rotate** any secret that ever touched history (item A, and B if you
choose to). Treat the leaked hex string as compromised regardless.

## Sign-off checklist (pre-publish)

- [ ] History cleaned or repo re-initialized (see above)
- [ ] Leaked key rotated / wallet abandoned
- [x] `<all_urls>` removed from `host_permissions` (explicit allowlist + optional) — item C
- [x] `nativeMessaging` removed — item D
- [ ] WalletConnect project id reviewed
- [ ] `npm run check:release` passes
- [ ] Fresh `npm ci && npm run build` produces a clean `dist/`
