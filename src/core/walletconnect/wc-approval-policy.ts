// src/core/walletconnect/wc-approval-policy.ts
//
// Pure, side-effect-free WalletConnect approval policy. This is the SINGLE
// source of truth for:
//   - which EVM chains / methods SIMPL will approve in a session,
//   - which requested chains/methods are rejected up-front vs. filtered out,
//   - how peer metadata is sanitized before it reaches storage / the UI.
//
// It contains NO chrome / WalletKit / DOM dependencies so it can be imported by
// both the offscreen engine (src/background/walletconnect-offscreen.ts) and the
// smoke test (scripts/check-walletconnect-approval.ts).

export const DEFAULT_EIP155_CHAINS = [
  "eip155:1",
  "eip155:56",
  "eip155:8453",
  "eip155:11155111",
];

export const SUPPORTED_EIP155_CHAINS: ReadonlySet<string> = new Set(DEFAULT_EIP155_CHAINS);

// Explicit allowlist of EVM JSON-RPC methods advertised in an approved session.
// A method is included ONLY when it has BOTH a request handler and a user-facing
// approval (or is a safe read-only / no-op response). See the block comment in
// walletconnect-offscreen.ts for why each excluded method is excluded
// (eth_sign, eth_signTypedData(_v3), wallet_addEthereumChain, wallet_sendCalls,
// wallet_getCallsStatus, wallet_showCallsStatus).
export const DEFAULT_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_watchAsset",
  "wallet_getCapabilities",
];

export const SUPPORTED_METHODS: ReadonlySet<string> = new Set(DEFAULT_METHODS);

// EVM methods that actually reach the approval/response layer via a
// session_request (see HANDLED_REQUEST_METHODS usage in the offscreen engine).
export const HANDLED_REQUEST_METHODS: ReadonlySet<string> = new Set([
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_watchAsset",
  "wallet_switchEthereumChain",
  "tron_signTransaction",
  "tron_signMessage",
  "tron_sendTransaction",
]);

export const DEFAULT_EVENTS = ["accountsChanged", "chainChanged"];

// --- TRON ---
export const TRON_WC_CHAIN = "tron:0x2b6653dc";
export const DEFAULT_TRON_METHODS = [
  "tron_signTransaction",
  "tron_signMessage",
  "tron_sendTransaction",
];
export const DEFAULT_TRON_EVENTS = ["accountsChanged", "chainChanged"];
export const SUPPORTED_TRON_METHODS: ReadonlySet<string> = new Set(DEFAULT_TRON_METHODS);

export function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value.length > 0)),
  );
}

export function collectNamespaceValues(
  proposal: any,
  namespace: "eip155" | "tron",
  key: "chains" | "methods" | "events",
  kind: "required" | "optional",
): string[] {
  const source = kind === "required" ? proposal?.requiredNamespaces : proposal?.optionalNamespaces;
  const value = source?.[namespace]?.[key];

  return Array.isArray(value) ? value.filter((v: unknown): v is string => typeof v === "string") : [];
}

export function proposalRequestsTron(proposal: any): boolean {
  return Boolean(proposal?.requiredNamespaces?.tron || proposal?.optionalNamespaces?.tron);
}

// Throws (→ reject BEFORE any approval surface) when a REQUIRED eip155 chain or
// method is outside what SIMPL supports. Optional unsupported entries are NOT a
// failure — they are simply filtered out of the approved namespaces later.
export function assertEip155ProposalSupported(proposal: any): void {
  for (const chain of collectNamespaceValues(proposal, "eip155", "chains", "required")) {
    if (!SUPPORTED_EIP155_CHAINS.has(chain)) {
      throw new Error(`Unsupported required network requested: ${chain}.`);
    }
  }

  for (const method of collectNamespaceValues(proposal, "eip155", "methods", "required")) {
    if (!SUPPORTED_METHODS.has(method)) {
      throw new Error(`Unsupported required method requested: ${method}.`);
    }
  }
}

// TRON equivalent — callable at proposal time (no TRON account needed).
export function assertTronProposalSupported(proposal: any): void {
  if (!proposalRequestsTron(proposal)) {
    return;
  }

  for (const chain of collectNamespaceValues(proposal, "tron", "chains", "required")) {
    if (chain !== TRON_WC_CHAIN) {
      throw new Error(`Unsupported required TRON network requested: ${chain}.`);
    }
  }

  for (const method of collectNamespaceValues(proposal, "tron", "methods", "required")) {
    if (!SUPPORTED_TRON_METHODS.has(method)) {
      throw new Error(`Unsupported required TRON method requested: ${method}.`);
    }
  }
}

// Approved eip155 chains: supported ∩ (required ∪ optional), or the default set
// when the dApp requested nothing supported. Unsupported REQUIRED chains are
// rejected earlier by assertEip155ProposalSupported.
export function getApprovedEip155Chains(proposal: any): string[] {
  const requested = uniqueStrings([
    ...collectNamespaceValues(proposal, "eip155", "chains", "required"),
    ...collectNamespaceValues(proposal, "eip155", "chains", "optional"),
  ]).filter((chain) => chain.startsWith("eip155:") && SUPPORTED_EIP155_CHAINS.has(chain));

  return requested.length > 0 ? requested : [...DEFAULT_EIP155_CHAINS];
}

// Approved eip155 methods: the supported allowlist ∪ (requested ∩ supported).
// Unsupported optional methods are dropped; unsupported required methods are
// rejected earlier by assertEip155ProposalSupported.
export function getApprovedEip155Methods(proposal: any): string[] {
  const requested = uniqueStrings([
    ...collectNamespaceValues(proposal, "eip155", "methods", "required"),
    ...collectNamespaceValues(proposal, "eip155", "methods", "optional"),
  ]).filter((method) => SUPPORTED_METHODS.has(method));

  return uniqueStrings([...DEFAULT_METHODS, ...requested]);
}

export function sanitizeMetaString(value: unknown, max = 128): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed.slice(0, max) : undefined;
}

// Only surface http(s) peer URLs/icons; anything else (javascript:, data:, …)
// is dropped so a hostile proposal cannot smuggle a scheme into the UI.
export function sanitizePeerUrl(value: unknown): string | undefined {
  const str = sanitizeMetaString(value, 2048);

  if (!str) {
    return undefined;
  }

  try {
    const parsed = new URL(str);

    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function isProposalExpired(expiry: number | undefined, nowMs: number): boolean {
  if (typeof expiry !== "number" || !Number.isFinite(expiry)) {
    return false;
  }

  return nowMs / 1000 > expiry;
}
