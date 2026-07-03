# Custom RPC — Security Model

How a user-supplied RPC endpoint is validated and permissioned. The policy and
validators live in `src/core/network/endpoint-inventory.ts`
(`isCustomRpcUrl`, `validateCustomRpcUrl`).

> **Status:** simpl does **not** ship a user-facing "add custom network / RPC"
> feature today — the default RPC URLs in `chain-registry.ts` are fixed. This
> document + the validators are the contract a future add-network UI must follow
> before it persists or uses any custom RPC. `optional_host_permissions:
> ["https://*/*"]` is already declared so that UI can request a specific host at
> runtime without a broad default grant.

## What counts as a custom RPC

Any `http(s)` URL that is **not** one of the known endpoints in the inventory
(`isCustomRpcUrl`). Known first-party/public endpoints are never treated as
custom.

## Validation (`validateCustomRpcUrl`)

A custom RPC is rejected unless:

- **Scheme** is `https://`. `http://` is allowed **only** with the dev-only
  `allowInsecure` flag (e.g. `http://localhost:8545` for local development);
  production never accepts `http://`.
- **Host is not private/internal.** Rejected by default (non-dev):
  `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16` (link-local), `::1`, `fc00::/7`, `fe80::/10`, `localhost`,
  `*.local`, and bracketed IPv6 literals. This prevents an added RPC from probing
  the user's LAN / internal services.
- **URL parses.** Malformed input is rejected.

## Required add-network flow (for the future UI)

1. User enters an RPC URL → `validateCustomRpcUrl(url)`; on failure show the
   returned reason.
2. Show a risk panel: the **origin/domain**, target **chain**, and the data that
   will be sent to it — address, balance queries, transaction simulation, and
   **signed/raw transactions for broadcast**. A custom RPC can see all of this.
3. Request the host permission at runtime:
   `chrome.permissions.request({ origins: ["https://<host>/*"] })`.
   - **Denied** → the RPC is **not** saved as active; show a clear error.
   - **Granted** → persist it in network config with `category: "custom-rpc"`,
     marked user-approved.
4. **Remove**: delete from config, best-effort
   `chrome.permissions.remove({ origins: [...] })`, and fall back to the default
   RPC for that chain.

## Secrets

Never store an API key/secret as a plain user-facing setting without an explicit
warning. First-party provider keys stay server-side in the getsimpl-api gateway
(see `docs/endpoint-inventory.md`); a custom RPC that needs auth is the user's own
responsibility and must be surfaced as sensitive.

## Enforced by

`scripts/check-endpoints.ts` unit-tests the validators (scheme, private ranges,
localhost, malformed, known-vs-custom) — part of `npm run check:release`.
