# Chrome Web Store — Listing Draft

Draft copy for the simpl Web Store listing. All claims are intentionally honest:
no "official", "approved", "#1", or "best wallet" language, and no features that
aren't shipped. Review before publishing and replace every `<placeholder>`.

## Single purpose

> simpl is a crypto wallet extension that lets users create, import, manage,
> send, receive, swap and bridge crypto assets across supported networks in a
> clean browser wallet interface.

## Name

simpl

## Short description (≤132 chars)

> Clean self-custodial crypto wallet for everyday Web3 — manage, send, receive,
> swap and bridge across EVM, Solana, Bitcoin & TRON.

## Full description

> simpl is a clean, self-custodial multi-chain crypto wallet for everyday Web3.
>
> Create or import a wallet and manage your assets across EVM chains (Ethereum,
> Base, BNB Chain, Polygon, Arbitrum, Optimism, Avalanche), Solana, Bitcoin and
> TRON — all from one minimal interface.
>
> Features:
> • Create or import a wallet with a standard recovery phrase
> • Multiple accounts across EVM, Solana, Bitcoin and TRON
> • Send and receive
> • Swap tokens on the same chain
> • Bridge assets across chains
> • Portfolio overview and per-asset detail pages with price charts
> • Connect to dApps via an injected provider and WalletConnect
> • Explicit approval popup for every connection and signature request
> • Manage connected sites and security settings
> • Light/dark themes and multiple languages
>
> You are in control: simpl is self-custodial. Your recovery phrase and private
> keys are encrypted and stored locally on your device and are never sent to us
> or anyone else. Always keep your own secure backup of your recovery phrase —
> if you lose it, no one can recover your wallet.
>
> simpl does not collect analytics or telemetry. Network requests are limited to
> blockchain nodes and the market/swap/bridge services needed to operate the
> wallet.

## Category

Productivity (or Developer Tools, per store options).

## Permission justifications (short forms for the listing)

- **storage** — Store your encrypted wallet, accounts, settings and connected
  sites locally.
- **tabs** — Notify connected dApp tabs of account/network changes and identify
  the requesting site for approvals.
- **windows** — Open the dedicated approval window for each connection and
  signature request.
- **sidePanel** — Let you use the wallet in Chrome's side panel.
- **offscreen** — Maintain the WalletConnect connection in the background.
- **nativeMessaging** — Optional: store your vault key in the macOS Keychain
  when the companion native helper is installed (macOS only). *(Remove this line
  if the permission is dropped for the store build.)*
- **Host access (all sites)** — Act as a wallet provider on any site you choose
  to connect to (like other Web3 wallets) and reach blockchain RPC/market
  endpoints, including custom networks you add.

## Data usage disclosure (draft)

simpl does not sell user data and uses no third-party analytics. Secrets (seed
phrase, private keys, password) are stored only on your device, encrypted, and
are never transmitted. Wallet addresses and quote parameters are sent to
blockchain nodes and swap/market/bridge APIs solely to operate the wallet. See
`docs/privacy-data-map.md` for the full breakdown.

## Test instructions for the reviewer

1. Install and open simpl from the toolbar.
2. Choose **Create wallet**, set a password, and securely note the recovery
   phrase shown (this is a test wallet — no funds required).
3. The wallet opens to the portfolio/home view. You can switch accounts and
   networks from the header.
4. To test import instead: **Import wallet** and paste a recovery phrase. You may
   use the standard public BIP-39 test vector
   `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`
   (a well-known empty test wallet — do not send real funds).
5. **Receive** shows the address + QR. **Send** opens the transfer form.
6. **Swap** and **Bridge** fetch live quotes; you can review a quote without
   broadcasting.
7. Open any dApp and trigger a connect/sign request, or use **WalletConnect** —
   note that every request opens an explicit approval popup before anything is
   signed.
8. Lock the wallet from the menu and unlock with the password to confirm the
   encrypted-vault flow.

No backend account or login is required to review the extension.

## Listing metadata placeholders

- Support email: `<support@your-domain>`
- Privacy policy URL: `<https://your-domain/privacy>`
- Website / homepage URL: `<https://your-domain>`
- Single-purpose statement: see top of this file.

> Reminder: the privacy policy URL is **mandatory** for an extension that handles
> wallet data. Publish a policy consistent with `docs/privacy-data-map.md`
> before submitting.
