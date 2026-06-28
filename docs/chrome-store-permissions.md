# Chrome Web Store — Permission Justifications

This document explains every permission and host permission requested in
`public/manifest.json`, where it is used in the code, whether it can be made
optional, and whether it can be narrowed. Use it both as internal reference and
as the source for the "permission justification" fields in the Web Store
listing.

Manifest version: **3**.

## `permissions`

| Permission | Why it is needed | Where used | Optional? | Can it be narrowed? |
| --- | --- | --- | --- | --- |
| `storage` | Persist the encrypted vault, accounts, settings, connected-sites list, theme/language. Core to a wallet. | `src/core/storage/storage.repository.ts` and everything built on it | No — required at all times | Already minimal |
| `sidePanel` | Open the wallet in Chrome's side panel (`side_panel.default_path`) as an alternative to the popup. | `src/sidepanel/*`, `side_panel` manifest key | Could be dropped if the side-panel UX is cut | Already scoped to this extension |
| `tabs` | Query open tabs to broadcast `accountsChanged` / `chainChanged` events to all connected dApp tabs, and to detect the active dApp origin for approvals. `chrome.tabs.query({})` needs full `tabs`, not `activeTab`. | `src/background/service-worker.ts` (`chrome.tabs.query`), `src/ui/components/SimplePage.tsx`, `src/sidepanel/launcher.ts`, `src/popup/surface-actions.ts` | No, given multi-tab dApp event fan-out | Cannot use `activeTab` (need all tabs, no user gesture); already the minimal API |
| `windows` | Create and focus the dedicated approval/signature popup windows and WalletConnect approval window; clean them up afterward. | `src/background/service-worker.ts` (`chrome.windows.create/update/remove`) | No — every signature/approval opens its own window | Already minimal |
| `offscreen` | Run the WalletConnect engine in an offscreen document (service workers can't hold the long-lived WC socket/crypto). | `src/background/service-worker.ts`, `src/background/walletconnect-offscreen.ts`, `walletconnect-offscreen.html` | Only if WalletConnect is removed | Already scoped |
| `nativeMessaging` | Optional: store/retrieve the vault key in the macOS Keychain via a separately installed native host (`com.local_evm_wallet.keychain`). Degrades gracefully when the host is absent. | `src/core/native/native-messaging.client.ts`, `src/popup/routes/UnlockPage.tsx`, `src/popup/routes/SettingsPage.tsx` | **Yes — candidate to make optional or remove.** The feature only works if the user installs the native host (macOS only); most Web Store users will not. | Native host name is fixed; messaging itself can't be narrowed |

### Notes / recommended follow-ups

- **`nativeMessaging`** is the weakest justification for a typical Web Store
  install because the companion native host is not distributed through the
  store. Options: (a) keep and clearly document it in the listing as an
  optional macOS-only convenience, (b) move it behind a build flag, or
  (c) drop it for the public store build. See `docs/security-review.md`.
- No `webRequest`, `scripting`, `alarms`, `activeTab`, `cookies`,
  `declarativeNetRequest`, `clipboardRead`, or `<all_urls>` *scripting*
  injection permission is requested — good.

## `content_scripts`

Two content scripts, both matching `<all_urls>` at `document_start`:

- `assets/inpage.js` — injected into the page's MAIN world to expose the
  EIP-1193 / TronLink-style provider (`window.ethereum`, `window.tron`) to
  dApps. (`src/inpage/inpage.ts`)
- `assets/content.js` — isolated-world bridge that relays messages between the
  page provider and the background service worker. (`src/content/content.ts`)

**Why `<all_urls>`:** the single purpose of the extension is to act as a wallet
provider on *any* website the user chooses to connect from. This mirrors every
mainstream wallet (MetaMask, etc.). It cannot be narrowed to a fixed domain
list without breaking the product. The provider only becomes active when a dApp
calls it and the user explicitly approves a connection.

## `host_permissions`

Current list (after removing the dev-only `localhost:8787` / `127.0.0.1:8787`
entries):

```
<all_urls>
https://ethereum-rpc.publicnode.com/*
https://ethereum-sepolia-rpc.publicnode.com/*
https://base-rpc.publicnode.com/*
https://bsc-rpc.publicnode.com/*
https://bsc-dataseed*.binance.org/*
https://binance.llamarpc.com/*
https://api.coingecko.com/*
https://api.0x.org/*
https://api.trongrid.io/*
```

| Entry | Why | Narrowable? |
| --- | --- | --- |
| `<all_urls>` | The background worker fetches from RPC / API endpoints that are **not** all enumerated in the explicit list (e.g. `api.getsimpl.io`, Solana RPC, Bitcoin Esplora, LI.FI), and supports user-added custom RPC URLs (`src/core/rpc/rpc.client.ts` accepts an arbitrary `rpcUrl`). Removing it today breaks Solana, Bitcoin, market data, and bridging. | **Load-bearing.** See hardening note below. |
| Explicit RPC / API hosts | Document the primary default endpoints the wallet talks to. Redundant while `<all_urls>` is present, kept for transparency. | n/a |

### Recommended hardening (manual decision, not done automatically)

To drop `<all_urls>` from `host_permissions` and satisfy reviewers' minimization
preference:

1. Enumerate **every** fetch target the worker uses (Simpl API, all default
   RPCs per chain, Solana, Esplora, LI.FI, CoinGecko, 0x/Simpl proxy).
2. Add them all to `host_permissions`.
3. Move `<all_urls>` to `optional_host_permissions` and request it at runtime
   only when the user adds a custom RPC network.

This was **not** applied automatically because an incomplete host list would
silently break chains in production. It requires a full endpoint inventory and
QA across all four chain families. Tracked in `docs/security-review.md`.
