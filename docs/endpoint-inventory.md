# Endpoint Inventory — simpl wallet

Every remote host the extension contacts, why, and how it maps to
`host_permissions` in `public/manifest.json`.

**Source of truth (code):** `src/core/network/endpoint-inventory.ts`. That
registry drives `host_permissions` (`getAllowedHostPermissions()`), the endpoint
scanner (`npm run check:endpoints`), the proxy policy (`npm run check:proxy`), and
the manifest equality check (`npm run check:manifest` fails if `host_permissions`
diverges from the registry). This doc is the human-readable mirror.

Last reviewed against code: `feat/endpoint-inventory-rpc-hardening`.

## Data sent per category

| Category | Address data | Raw tx | Via Simpl proxy | Notes |
| --- | --- | --- | --- | --- |
| `simpl-api` (api.getsimpl.io) | yes (balance/portfolio) | no | first-party | upstream keys server-side |
| `swap-api` (0x) | yes (taker) | no | **required in production** | dev-only direct fallback |
| `bridge-api` (LI.FI) | yes | no | first-party (getsimpl) | integrator/fee/key server-side |
| `evm-rpc` / `solana-rpc` / `tron-rpc` | yes | yes (broadcast) | no (public RPC) | — |
| `bitcoin-api` (Esplora) | yes (queries) | yes | no | — |
| `walletconnect` | no | no | no | pairing metadata only |
| `token-metadata` (IPFS/Arweave) | no | no | no | public metadata JSON |

Seeds, private keys, signatures and raw-tx payloads are **never** sent to any
non-RPC endpoint and never logged. RPC endpoints receive only what a blockchain
node inherently needs (address, signed/raw tx for broadcast).

## Fetched hosts (require `host_permissions`)

These are contacted via `fetch` from the background/offscreen/extension pages, so
they are declared explicitly. `host_permissions` no longer uses `<all_urls>`.

| Host | Purpose | Referenced in |
| --- | --- | --- |
| `ethereum-rpc.publicnode.com` | Ethereum JSON-RPC | `core/networks/chain-registry.ts`, `SwapPage` receipt RPC |
| `ethereum-sepolia-rpc.publicnode.com` | Sepolia JSON-RPC | chain-registry, swap receipt |
| `base-rpc.publicnode.com` | Base JSON-RPC | chain-registry, swap receipt |
| `bsc-rpc.publicnode.com` | BNB Smart Chain JSON-RPC | chain-registry, swap receipt |
| `solana-rpc.publicnode.com` | Solana RPC (primary) | `chains/solana/solana.config.ts` |
| `solana.drpc.org` | Solana RPC (fallback) | `chains/solana/solana.config.ts` |
| `api.mainnet-beta.solana.com` | Solana RPC (low-priority fallback) | `chains/solana/solana.config.ts`, chain-registry |
| `api.devnet.solana.com` | Solana devnet RPC | `chains/solana/solana.config.ts`, chain-registry |
| `api.trongrid.io` | TRON JSON-RPC / TronGrid API | chain-registry, TRON adapter |
| `blockstream.info` | Bitcoin Esplora API (mainnet `/api`, testnet `/testnet/api`) | chain-registry, BTC adapter |
| `api.getsimpl.io` | **Primary gateway** — prices/charts, TON RPC (`/v1/ton`), Solana portfolio, LI.FI bridge proxy, swap proxy, provider health | `core/prices/*`, `core/bridge/lifi-bridge.service.ts`, `core/swaps/*`, `core/ton/*`, `chains/solana/solana.portfolio-api.ts`, `core/api/provider-health.service.ts` |
| `api.0x.org` | 0x swap API — **production must use the Simpl swap proxy**; direct calls (with a client-side `0x-api-key`) are a DEV-only fallback and `getZeroXBaseUrl()` throws in a production build if the proxy is unset | `core/swap/zeroXSwapService.ts` |
| `*.walletconnect.com`, `*.walletconnect.org` | WalletConnect verify / explorer / relay-discovery over HTTPS (relay itself is WSS, governed by CSP) | `@reown/walletkit` + `@walletconnect/core` in `background/walletconnect-offscreen.ts` |
| `arweave.net`, `ipfs.io`, `cloudflare-ipfs.com`, `dweb.link`, `gateway.pinata.cloud` | Solana off-chain token/NFT **metadata JSON** gateways | `chains/solana/solana.tokens.ts` |

## NOT in `host_permissions` (by design)

| Host(s) | Why no host permission is needed |
| --- | --- |
| Block explorers: `etherscan.io`, `bscscan.com`, `basescan.org`, `tronscan.org`, `solscan.io`, `tonviewer.com`, `mempool.space` | Opened as links in a new browser tab (`blockExplorerUrl`), never fetched. |
| Token-logo CDNs: `assets.trustwalletapp.com`, `tokens.1inch.io` | Loaded as `<img src>`, covered by CSP `img-src https:`. `token-logo-resolver.ts` only returns URL strings. |

## Removed (dead entries — were in the old manifest, not referenced in code)

`bsc-dataseed*.binance.org`, `binance.llamarpc.com`, `api.coingecko.com`
(CoinGecko data now flows through `api.getsimpl.io`).

## Known behavior note — arbitrary Solana metadata hosts

`chains/solana/solana.tokens.ts` also fetches metadata from **arbitrary on-chain
`https://` URIs** (a token can point its metadata anywhere). With `<all_urls>`
removed, such fetches now rely on the target host's CORS headers instead of the
extension's blanket grant: CORS-permissive hosts still work, restrictive ones
degrade gracefully (the token still renders from on-chain data; off-chain
name/logo enrichment is skipped).

**Follow-up (Stage 3+):** route Solana off-chain metadata through an
`api.getsimpl.io` proxy so no arbitrary-host fetch is required.

## Custom RPC

There is currently **no user-facing custom-RPC feature** (registry RPC URLs are
hardcoded). If one is added, request the specific host at runtime via
`chrome.permissions.request` against `optional_host_permissions` (`https://*/*`)
rather than widening the default `host_permissions`.
