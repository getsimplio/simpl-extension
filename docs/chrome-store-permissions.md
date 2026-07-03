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

`nativeMessaging` was **removed** — no native host is shipped and no code uses
the native-messaging API (verified: `src/core/native` does not exist, and there
are no `connectNative`/`sendNativeMessage` references). `scripts/check-manifest.ts`
fails the release gate if `nativeMessaging` reappears without a shipped host.

### Notes

- No `webRequest`, `scripting`, `alarms`, `activeTab`, `cookies`,
  `declarativeNetRequest`, `clipboardRead`, or `nativeMessaging` permission is
  requested — good.

## `content_scripts`

Two content scripts, both matching **`http://*/*` + `https://*/*`** at
`document_start`:

- `assets/inpage.js` — injected into the page's MAIN world to expose the
  EIP-1193 / TronLink-style provider (`window.ethereum`, `window.tron`) to
  dApps. (`src/inpage/inpage.ts`)
- `assets/content.js` — isolated-world bridge that relays messages between the
  page provider and the background service worker. (`src/content/content.ts`)

**Why a broad match:** the single purpose of the extension is to act as a wallet
provider on *any* website the user chooses to connect from. This mirrors every
mainstream wallet (MetaMask, etc.) and cannot be narrowed to a fixed domain list
without breaking the product. The provider only becomes active when a dApp calls
it and the user explicitly approves a connection. We use `http/https` rather than
`<all_urls>` so `file://`, `ftp://`, etc. are **not** matched — injection is
scoped to web pages only. (Note: content-script `matches` govern *injection*, a
separate mechanism from `host_permissions`, which govern the extension's own
`fetch`/CORS.)

## `host_permissions`

`<all_urls>` has been **removed**. `host_permissions` is now an explicit
allowlist **generated from and verified against** the endpoint inventory
(`src/core/network/endpoint-inventory.ts` → `getAllowedHostPermissions()`);
`npm run check:manifest` fails if the manifest and the registry diverge. The
authoritative per-host justification is **`docs/endpoint-inventory.md`**; summary:

```
https://ethereum-rpc.publicnode.com/*          (EVM RPC)
https://ethereum-sepolia-rpc.publicnode.com/*  (EVM RPC)
https://base-rpc.publicnode.com/*              (EVM RPC)
https://bsc-rpc.publicnode.com/*               (EVM RPC)
https://solana-rpc.publicnode.com/*            (Solana RPC)
https://solana.drpc.org/*                      (Solana RPC)
https://api.mainnet-beta.solana.com/*          (Solana RPC)
https://api.devnet.solana.com/*                (Solana RPC)
https://api.trongrid.io/*                      (TRON RPC/API)
https://blockstream.info/*                     (Bitcoin Esplora)
https://api.getsimpl.io/*                       (prices/charts/TON/portfolio/bridge/swap/health gateway)
https://api.0x.org/*                            (0x swap fallback)
https://*.walletconnect.com/*                   (WalletConnect infra)
https://*.walletconnect.org/*                   (WalletConnect infra)
https://arweave.net/*                           (Solana metadata)
https://ipfs.io/*                               (Solana metadata)
https://cloudflare-ipfs.com/*                   (Solana metadata)
https://dweb.link/*                             (Solana metadata)
https://gateway.pinata.cloud/*                  (Solana metadata)
```

`optional_host_permissions: ["https://*/*"]` provides a runtime-requestable
escape hatch for a future custom-RPC feature (requested per-host via
`chrome.permissions.request`) — it grants nothing at install time.

`scripts/check-manifest.ts` fails the release gate if `<all_urls>` reappears in
`host_permissions`, or if a required host is missing, or if a removed dead host
returns.

### Known behavior note

Solana off-chain token metadata hosted on arbitrary (non-gateway) `https` hosts
now relies on that host's CORS instead of the former blanket grant — it degrades
gracefully. Proper fix (route through the `api.getsimpl.io` proxy) is tracked in
`docs/endpoint-inventory.md` and `docs/security-review.md`.
