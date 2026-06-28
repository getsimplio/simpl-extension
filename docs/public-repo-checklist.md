# Public Repository Checklist

Run through this before flipping the GitHub repo to public.

## Secrets

- [x] No private keys / API keys / passwords hardcoded in `src/` or `scripts/`.
- [x] Leaked 64-hex string removed from `readme.md` (now `README.md`).
- [x] `.env`, `.env.local`, `.env.*.local`, `.env*.bak*` are gitignored.
- [x] `.env.example` contains only placeholders.
- [ ] **Git history scrubbed** of the old `readme.md` contents, `.env*`, and
      `native/macos/build/` — or repo re-initialized with fresh history.
      *(Manual — see `docs/security-review.md` "Git history note".)*
- [ ] **Leaked key rotated / wallet abandoned.** *(Manual.)*
- [ ] WalletConnect project id reviewed/rotated if desired. *(Manual.)*

## Junk removed (this branch)

- [x] `=` (empty stray file)
- [x] `simpl-dapp-test.html` (dev page)
- [x] `native/macos/build/local-evm-wallet-keychain-host` (compiled binary)
- [x] `public/.DS_Store`, `public/manifest.json.bak-*` (were leaking into `dist/`)
- [ ] Optional: remove local-only gitignored cruft you don't want lying around:
      `.env.local.bak-*`, `.package-lock.json`, `.patch-backups/`,
      `.disabled-tsx-backups/`, `swap_settings_context.txt`,
      `export_claude_design_context.py`, root `.DS_Store`. *(Gitignored already,
      so they won't publish — cleanup is cosmetic.)*

## Repo hygiene files

- [x] `README.md` — what/why, install, dev, build, load-unpacked, env vars,
      "never commit secrets" warning, project status.
- [x] `.gitignore` updated.
- [x] `.env.example` present.
- [x] `SECURITY.md` present.
- [x] `CONTRIBUTING.md` present.
- [x] `docs/` — permissions, privacy map, store listing, security review.
- [ ] `LICENSE` file — `package.json` says ISC, but no standalone `LICENSE`
      file exists. **Owner decision** to add one (not added automatically).

## Build / package hygiene

- [x] Vite inputs are explicit; design-system mockups with remote scripts are
      not bundled.
- [x] `npm run zip:cws` excludes `.DS_Store` and `.map` files.
- [ ] Decide whether to ship sourcemaps. Default Vite prod build does not emit
      them; keep it that way for the store zip.
- [ ] Verify the store zip after build: `unzip -l simpl-cws.zip` should show
      only runtime files (manifest, html, assets, icons) — no docs, tests,
      `.env`, or notes.

## Final commands

See the "Commands" section of the handoff report / `README.md`.
