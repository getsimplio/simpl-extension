# Privacy & Data Map

How simpl handles user data. This is the source for the Chrome Web Store
"Privacy practices" / data-disclosure form and for a future privacy policy.

**Summary:** simpl is self-custodial. Secrets (seed phrase, private keys) are
generated and stored **locally** in an encrypted vault and are **never**
transmitted off the device. There is **no analytics, telemetry, or
error-reporting SDK** in the codebase. Network requests go only to blockchain
RPC nodes and to data/market/swap APIs required to operate the wallet.

## Data table

| Data type | Where stored | Why needed | Shared with backend / third parties? | Retention | User control / delete | CWS disclosure category |
| --- | --- | --- | --- | --- | --- | --- |
| Seed phrase / mnemonic | Local encrypted vault (`chrome.storage`), encrypted with a key derived from the user password | Derive accounts; sign transactions | **No** — never leaves device unencrypted | Until wallet removed / extension data cleared | Reveal (password-gated) and wallet reset/remove | Not collected / not transmitted |
| Private keys | Derived in-memory from the vault when unlocked; never persisted in plaintext | Sign transactions | **No** | In-memory only while unlocked | Auto-lock clears; reset removes | Not collected / not transmitted |
| Wallet password | Never stored; held transiently to unlock | Decrypt vault | **No** — never logged or stored | Transient (in-memory during unlock) | n/a | Not collected / not transmitted |
| Optional vault key in OS Keychain (macOS) | macOS Keychain via native host, opt-in | Unlock convenience / biometrics | Local OS keychain only (not a remote party) | Until user deletes the keychain credential | Settings → remove credential | Not collected / not transmitted (local OS) |
| Account addresses | Local storage | Show balances, build transactions | Sent to **RPC nodes** and **swap/bridge APIs** as the `from`/`taker` when you query balances or request a quote (inherent to using a blockchain) | Local until removed; third parties per their own policies | Remove account / reset | Required for functionality |
| Balances | Fetched live from RPC; cached locally | Portfolio / asset view | Derived from RPC queries (node sees address + IP) | Cache cleared on lock/refresh | Reset / clear data | Required for functionality |
| Transaction history | Read from chain / explorers; some local metadata | Activity view, asset details | Queried from RPC / explorer / Simpl API | Local cache; chain data is public & permanent | Reset / clear data | Required for functionality |
| Connected sites & dApp approvals | Local storage | Remember which origins you approved | **No** (local only) | Until revoked | Connected Sites page → revoke | Not transmitted |
| Token / market prices & charts | Fetched from Simpl API gateway (`api.getsimpl.io`), CoinGecko | Show fiat values & charts | Request sends **token contract address + chainId + range** (public identifiers), **not** your wallet address | Not retained by the wallet beyond cache | n/a | Required for functionality |
| Swap quotes | 0x API (directly or via the Simpl/Cloudflare proxy) | Same-chain swaps | Sends token pair, amount, and your address as taker | Per provider policy | n/a | Required for functionality |
| Bridge quotes | LI.FI via Simpl API proxy | Cross-chain bridging | Sends route params incl. your address | Per provider policy | n/a | Required for functionality |
| Theme / language / UI prefs | Local storage + `localStorage` mirror | Persist preferences | **No** | Until changed | Settings | Not transmitted |

## Third parties contacted (network egress)

- Blockchain RPC nodes: PublicNode (ETH/Base/BSC/Sepolia), Binance dataseed,
  llamarpc, TronGrid, Solana RPC, Bitcoin Esplora. They observe the queried
  address and the client IP — inherent to any wallet.
- `api.getsimpl.io` — first-party gateway for market data and the swap/bridge
  proxy.
- `api.coingecko.com` — price/market data fallback.
- `api.0x.org` — swap quotes (or via the Cloudflare proxy in `proxy/`).
- WalletConnect relay (Reown) — only when the user initiates a WalletConnect
  session.

## What is NOT done

- No advertising, no fingerprinting, no third-party analytics/telemetry SDKs.
- No selling or transfer of user data.
- No collection of seed phrases, private keys, or passwords.
- No off-device storage of secrets.

## Chrome Web Store data-disclosure answers (draft)

- **Does the extension collect/use data?** Only data required to operate the
  wallet (addresses/quotes sent to blockchain nodes and swap/market APIs). No
  analytics.
- **Personally identifiable / financial info:** wallet activity is pseudonymous
  on public blockchains; addresses are transmitted to nodes/APIs to function.
- **Authentication info / passwords:** not collected, not transmitted.
- **Sold to third parties:** No.
- **Used for purposes unrelated to core functionality:** No.
- **Used for creditworthiness / lending:** No.
