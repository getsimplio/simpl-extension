# simpl

A clean, self-custodial multi-chain crypto wallet browser extension for everyday Web3.

simpl lets you create or import a wallet and manage assets across **EVM chains,
Solana, Bitcoin, and TRON** from one minimal interface — send, receive, swap,
bridge, view your portfolio and asset details, connect to dApps via an injected
provider and WalletConnect, and approve every signature explicitly.

> **Status:** early / pre-1.0 (`0.1.0`). Self-custodial — you hold your keys.
> Use at your own risk and always keep an independent backup of your recovery
> phrase.

## Features

- Create / import HD wallets (BIP-39), multiple accounts
- Multi-chain: EVM (Ethereum, Base, BNB, Polygon, Arbitrum, Optimism, Avalanche,
  Sepolia), Solana, Bitcoin, TRON
- Send / receive
- Same-chain swaps and cross-chain bridging
- Portfolio overview and per-asset detail pages
- WalletConnect + injected dApp provider with explicit approval popups
- Connected-sites management and security settings
- Local, encrypted vault storage — secrets never leave the device unencrypted
- Light / dark themes and multi-language UI

## Tech stack

React 19 + Vite, TypeScript, Chrome Manifest V3 (service worker), ethers v6,
`@solana/web3.js`, `@scure/btc-signer`, `tronweb`, `@reown/walletkit`
(WalletConnect).

## Getting started

### Prerequisites

- Node.js 20+
- npm (a `package-lock.json` is committed — use `npm ci` for reproducible installs)

### Install

```bash
npm ci
```

### Configure environment

Copy the example env file and fill in your own values. **Never commit real
secrets or a `.env.local`.**

```bash
cp .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `VITE_SIMPL_API_URL` | Market-data + swap proxy gateway (default `https://api.getsimpl.io`) |
| `VITE_SIMPL_SWAP_PROXY_URL` | Optional override for the 0x swap proxy |
| `VITE_WALLETCONNECT_PROJECT_ID` | Your WalletConnect Cloud project id |
| `VITE_0X_API_KEY` | Only for the standalone `proxy/` worker, not the extension bundle |
| `VITE_SIMPLE_SWAP_FEE_RECIPIENT` / `VITE_SIMPLE_SWAP_FEE_BPS` | Optional swap fee config |
| `VITE_LIFI_INTEGRATOR` / `VITE_LIFI_FEE` | LI.FI bridge integrator + fee fraction |

### Develop

```bash
npm run dev
```

### Type-check

```bash
npm run typecheck
```

### Production build

```bash
npm run build      # tsc --noEmit && vite build  -> dist/
```

### Package for Chrome Web Store

```bash
npm run zip:cws    # builds, then zips dist/ into simpl-<version>.zip
```

## Load the unpacked extension in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `dist/` folder.
5. Pin **simpl** and open it from the toolbar.

## Security

- **Never commit** seed phrases, private keys, mnemonics, passwords, or real
  `.env*` files. The repo is configured to ignore them — keep it that way.
- Secrets are stored only in the local encrypted vault; the wallet never
  transmits your seed or private keys.
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## Repository layout

- `src/` — extension source (popup, side panel, background service worker, core
  wallet/chain/storage logic, UI)
- `public/` — static assets and `manifest.json` (copied verbatim into `dist/`)
- `scripts/` — local dev/verification scripts (use standard public BIP-39 test
  vectors, not real funds)
- `proxy/` — optional Cloudflare Worker that proxies 0x swap requests and keeps
  the 0x API key server-side
- `native/` — optional macOS native-messaging host (Swift source) for OS-keychain
  vault-key storage
- `docs/` — Chrome Web Store and public-repo documentation

## License

ISC — see `package.json`. (A standalone `LICENSE` file can be added by the
project owner.)
