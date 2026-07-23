// src/core/network/endpoint-inventory.ts
//
// Single source of truth for every remote host the extension may contact.
// Consumed by: the manifest release check (host_permissions must equal
// getAllowedHostPermissions()), the endpoint scanner (check:endpoints), the
// proxy check, and the docs. Pure — no chrome/DOM deps.
//
// It intentionally lists only hosts reached via fetch/WebSocket/RPC that need a
// host permission or a production policy. Block-explorer links (opened in a new
// tab) and <img>-loaded logo CDNs are NOT here — they need no host permission.

export type EndpointCategory =
  | "simpl-api"
  | "evm-rpc"
  | "solana-rpc"
  | "tron-rpc"
  | "bitcoin-api"
  | "price-api"
  | "swap-api"
  | "bridge-api"
  | "walletconnect"
  | "token-metadata"
  | "custom-rpc";

export type EndpointPolicy = {
  id: string;
  category: EndpointCategory;
  // Host or wildcard host (e.g. "api.getsimpl.io", "*.walletconnect.org").
  origin: string;
  purpose: string;
  environment: "production" | "development" | "test" | "all";
  // Contributes an entry to manifest host_permissions.
  permissionRequired: boolean;
  // Production MUST route through the Simpl proxy, not this origin directly.
  mustUseProxy: boolean;
  allowsUserData: boolean;
  allowsAddressData: boolean;
  allowsRawTxData: boolean;
  notes?: string;
};

export const ENDPOINT_INVENTORY: readonly EndpointPolicy[] = [
  {
    id: "simpl-api",
    category: "simpl-api",
    origin: "api.getsimpl.io",
    purpose:
      "First-party gateway: prices/charts, TON RPC (/v1/ton), Solana portfolio, LI.FI bridge proxy, swap proxy, provider health, runtime config (/v1/config/runtime), union token catalog (/v1/tokens/catalog). Upstream API keys live server-side.",
    environment: "all",
    permissionRequired: true,
    mustUseProxy: false,
    allowsUserData: true,
    allowsAddressData: true,
    allowsRawTxData: false,
  },
  {
    id: "zerox",
    category: "swap-api",
    origin: "api.0x.org",
    purpose:
      "0x EVM swap quotes. Production MUST go through the Simpl swap proxy; direct calls (with a client-side 0x-api-key) are a DEV-only fallback.",
    environment: "development",
    permissionRequired: true,
    mustUseProxy: true,
    allowsUserData: true,
    allowsAddressData: true,
    allowsRawTxData: false,
    notes:
      "Retained in host_permissions only for the dev direct fallback; production is enforced onto api.getsimpl.io in zeroXSwapService.",
  },
  // ── EVM RPC (public) ───────────────────────────────────────────────────────
  ...(
    [
      ["evm-eth", "ethereum-rpc.publicnode.com", "Ethereum JSON-RPC"],
      ["evm-sepolia", "ethereum-sepolia-rpc.publicnode.com", "Sepolia JSON-RPC"],
      ["evm-base", "base-rpc.publicnode.com", "Base JSON-RPC"],
      ["evm-bsc", "bsc-rpc.publicnode.com", "BNB Smart Chain JSON-RPC"],
    ] as const
  ).map(
    ([id, origin, purpose]): EndpointPolicy => ({
      id,
      category: "evm-rpc",
      origin,
      purpose,
      environment: "all",
      permissionRequired: true,
      mustUseProxy: false,
      allowsUserData: false,
      allowsAddressData: true,
      allowsRawTxData: true,
    }),
  ),
  // ── Solana RPC (public + fallbacks) ─────────────────────────────────────────
  ...(
    [
      ["sol-publicnode", "solana-rpc.publicnode.com", "Solana RPC (primary)"],
      ["sol-drpc", "solana.drpc.org", "Solana RPC (fallback)"],
      ["sol-mainnet", "api.mainnet-beta.solana.com", "Solana RPC (fallback)"],
      ["sol-devnet", "api.devnet.solana.com", "Solana devnet RPC"],
    ] as const
  ).map(
    ([id, origin, purpose]): EndpointPolicy => ({
      id,
      category: "solana-rpc",
      origin,
      purpose,
      environment: "all",
      permissionRequired: true,
      mustUseProxy: false,
      allowsUserData: false,
      allowsAddressData: true,
      allowsRawTxData: true,
    }),
  ),
  {
    id: "tron",
    category: "tron-rpc",
    origin: "api.trongrid.io",
    purpose: "TRON JSON-RPC / TronGrid API. Any API key is server-side, never a client secret.",
    environment: "all",
    permissionRequired: true,
    mustUseProxy: false,
    allowsUserData: false,
    allowsAddressData: true,
    allowsRawTxData: true,
  },
  {
    id: "bitcoin-esplora",
    category: "bitcoin-api",
    origin: "blockstream.info",
    purpose: "Bitcoin Esplora API (mainnet /api, testnet /testnet/api) — balance, UTXO, history, broadcast.",
    environment: "all",
    permissionRequired: true,
    mustUseProxy: false,
    allowsUserData: false,
    allowsAddressData: true,
    allowsRawTxData: true,
  },
  // ── WalletConnect infrastructure ────────────────────────────────────────────
  ...(
    [
      ["wc-com", "*.walletconnect.com"],
      ["wc-org", "*.walletconnect.org"],
    ] as const
  ).map(
    ([id, origin]): EndpointPolicy => ({
      id,
      category: "walletconnect",
      origin,
      purpose: "WalletConnect verify / explorer / relay-discovery over HTTPS (relay itself is WSS via CSP).",
      environment: "all",
      permissionRequired: true,
      mustUseProxy: false,
      allowsUserData: false,
      allowsAddressData: false,
      allowsRawTxData: false,
    }),
  ),
  // ── Solana off-chain token metadata gateways ────────────────────────────────
  ...(
    [
      ["meta-arweave", "arweave.net"],
      ["meta-ipfs", "ipfs.io"],
      ["meta-cf-ipfs", "cloudflare-ipfs.com"],
      ["meta-dweb", "dweb.link"],
      ["meta-pinata", "gateway.pinata.cloud"],
    ] as const
  ).map(
    ([id, origin]): EndpointPolicy => ({
      id,
      category: "token-metadata",
      origin,
      purpose: "Solana off-chain token/NFT metadata JSON (ipfs:// / ar:// resolution).",
      environment: "all",
      permissionRequired: true,
      mustUseProxy: false,
      allowsUserData: false,
      allowsAddressData: false,
      allowsRawTxData: false,
    }),
  ),
];

// Private / internal IP ranges that a custom RPC must not target in production.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
  /\.local$/i,
  /^\[/, // bracketed IPv6 literal
];

function normalizeHost(origin: string): string {
  return origin.replace(/^\*\./, "").toLowerCase();
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesOrigin(host: string, policyOrigin: string): boolean {
  const p = policyOrigin.toLowerCase();
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === p;
}

export function getEndpointPolicy(url: string): EndpointPolicy | null {
  const host = hostFromUrl(url);
  if (!host) return null;
  return ENDPOINT_INVENTORY.find((p) => matchesOrigin(host, p.origin)) ?? null;
}

export function isKnownEndpoint(url: string): boolean {
  return getEndpointPolicy(url) !== null;
}

export function isProxyRequired(url: string): boolean {
  return getEndpointPolicy(url)?.mustUseProxy === true;
}

// The exact host_permissions match-pattern list the manifest must contain,
// derived from the inventory (permissionRequired policies only).
export function getAllowedHostPermissions(): string[] {
  const set = new Set<string>();
  for (const p of ENDPOINT_INVENTORY) {
    if (p.permissionRequired) {
      set.add(`https://${p.origin}/*`);
    }
  }
  return Array.from(set).sort();
}

// ── Custom RPC validation (Stage 5.5) ───────────────────────────────────────
// There is no user-facing custom-RPC feature yet; this is the pure policy a
// future "add network" UI must enforce before persisting/using a custom RPC.

export type CustomRpcValidation = { valid: boolean; reason?: string };

export function isCustomRpcUrl(url: string): boolean {
  // A custom RPC is any http(s) URL that is NOT one of our known endpoints.
  const host = hostFromUrl(url);
  if (!host) return false;
  return !isKnownEndpoint(url);
}

export function validateCustomRpcUrl(url: string, opts?: { allowInsecure?: boolean }): CustomRpcValidation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "Enter a valid URL." };
  }

  const allowInsecure = opts?.allowInsecure === true; // dev only
  if (parsed.protocol !== "https:" && !(allowInsecure && parsed.protocol === "http:")) {
    return { valid: false, reason: "Only https:// RPC URLs are allowed." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!allowInsecure && PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    return { valid: false, reason: "Private or internal addresses are not allowed." };
  }

  return { valid: true };
}
