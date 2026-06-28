# Security Policy

simpl is a self-custodial crypto wallet. We take security seriously and
appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately to: `<security@your-domain>` *(replace before
publishing)*. If available, use GitHub's **Private vulnerability reporting**
(Security → Advisories).

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version / commit.

We aim to acknowledge reports within a few business days and will keep you
updated on remediation.

## Scope

In scope:

- Key/seed handling, the encrypted vault, and the unlock flow.
- Transaction/signature approval flow and dApp provider.
- WalletConnect handling.
- Storage of sensitive data.

Out of scope:

- Vulnerabilities in upstream dependencies already publicly disclosed (report
  upstream), unless we ship an exploitable configuration.
- Issues requiring a compromised OS, malicious native host, or physical access.

## For users — protect yourself

- **Never share your recovery phrase or private keys.** No legitimate party,
  including the simpl team, will ever ask for them.
- simpl stores your secrets **encrypted and locally**; they are never sent off
  your device. Keep your own offline backup of your recovery phrase.
- Always review the approval popup before signing any transaction or message.

## For contributors

- Never commit seed phrases, private keys, mnemonics, passwords, or real
  `.env*` files.
- Never log secrets (seed, mnemonic, private key, password, vault key, raw
  signatures).
- Every signature/connection must go through an explicit user approval.
- Do not add remote code execution (`eval`, remote scripts) — it violates the
  Manifest V3 CSP and Chrome Web Store policy.
