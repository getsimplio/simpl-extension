# Contributing to simpl

Thanks for your interest in improving simpl. This is a security-sensitive
project (a self-custodial crypto wallet), so a few rules are non-negotiable.

## Golden rules

1. **Never commit secrets.** No seed phrases, private keys, mnemonics,
   passwords, API keys, or real `.env*` files. Use `.env.local` (gitignored) for
   local config and keep `.env.example` as the documented template.
2. **Never log secrets.** No `console.*` output of seed phrases, mnemonics,
   private keys, passwords, vault keys, raw transactions, or signatures.
3. **No remote code.** No `eval`, `new Function`, dynamic script injection, or
   remote `<script src>` in shipped code. It breaks the Manifest V3 CSP and
   violates Chrome Web Store policy.
4. **Explicit user approval** for every signature, connection, and network
   change. Never auto-sign.
5. **Least privilege.** Don't add new `permissions` / `host_permissions`
   without justification — update `docs/chrome-store-permissions.md` if you do.

## Development setup

```bash
npm ci
cp .env.example .env.local   # fill in your own values
npm run dev
```

## Before opening a pull request

```bash
npm run typecheck    # tsc --noEmit, must pass
npm run build        # must produce a clean dist/
git diff --check     # no whitespace errors / conflict markers
```

- Keep changes small and focused.
- Match the surrounding code style (naming, formatting, comment density).
- Don't reformat unrelated files.
- If you touch chain logic, run the relevant `npm run check:*` script.

## Reporting vulnerabilities

See [SECURITY.md](SECURITY.md). Report privately, not via public issues.
