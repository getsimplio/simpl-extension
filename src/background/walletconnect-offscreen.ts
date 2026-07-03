/// <reference types="chrome" />

import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";

import {
  DEFAULT_EVENTS,
  DEFAULT_TRON_EVENTS,
  DEFAULT_TRON_METHODS,
  HANDLED_REQUEST_METHODS,
  SUPPORTED_TRON_METHODS,
  TRON_WC_CHAIN,
  assertEip155ProposalSupported,
  assertTronProposalSupported,
  collectNamespaceValues,
  getApprovedEip155Chains,
  getApprovedEip155Methods,
  isProposalExpired,
  proposalRequestsTron,
  sanitizeMetaString,
  sanitizePeerUrl,
  uniqueStrings,
} from "../core/walletconnect/wc-approval-policy";

const PENDING_WALLETCONNECT_REQUEST_KEY = "pendingWalletConnectRequest";
const PENDING_WALLETCONNECT_PROPOSAL_KEY = "pendingWalletConnectProposal";
// Minimal, non-sensitive rejection notice so the popup can explain WHY a
// proposal was rejected before any approval surface was shown (e.g. unsupported
// required method). Stores only a human-readable message + timestamp — never a
// proposal/request payload.
const WALLETCONNECT_PROPOSAL_ERROR_KEY = "lastWalletConnectProposalError";
const CONNECTED_SITES_KEY = "connectedSites";
const WATCHED_ASSETS_KEY = "watchedAssets";

type WalletConnectPendingRequest = {
  topic: string;
  id: number;
  method: string;
  params: unknown;
  chainId?: string;
  receivedAt: string;
};

// Sanitized snapshot of a session proposal that is safe to persist in
// chrome.storage.local and render in the approval UI. It contains NO raw
// proposal payload / debug blob — only the fields the user needs to make an
// informed Approve/Reject decision. See buildSanitizedPendingProposal.
type SanitizedPendingProposal = {
  id: number;
  peerName: string;
  peerUrl: string;
  peerIcon?: string;
  requestedChains: string[];
  requiredMethods: string[];
  optionalMethods: string[];
  requestedTron: boolean;
  address: string;
  createdAt: string;
  expiry?: number;
};

type SimpleRuntimeMessage = {
  type?: string;
  uri?: string;
  password?: string;
  requestId?: number;
};

type ConnectedSite = {
  id: string;
  origin: string;
  name?: string;
  iconUrl?: string;
  type?: "evm" | "tron" | "walletconnect";
  connectedAt?: string;
  lastUsedAt?: string;
};

type WatchedAsset = {
  id: string;
  type: "ERC20";
  chainId?: number;
  chainNamespace?: string;
  address: string;
  symbol: string;
  decimals: number;
  image?: string;
  name?: string;
  addedAt: string;
  updatedAt: string;
};

let walletKitPromise: Promise<Awaited<ReturnType<typeof WalletKit.init>>> | null = null;

// Raw session proposals kept in memory ONLY (never written to storage) so we can
// call approveSession/rejectSession on the exact proposal that arrived. Keyed by
// proposal id. Cleared on approve/reject/expiry/session_delete.
const proposalCache = new Map<number, any>();

function sendServiceWorkerMessage<TResponse = { ok?: boolean; error?: string }>(
  message: Record<string, unknown>,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response?: TResponse) => {
      const lastError = chrome.runtime.lastError?.message;

      if (lastError) {
        reject(new Error(lastError));
        return;
      }

      resolve(response as TResponse);
    });
  });
}



function getProjectId(): string {
  return import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";
}

function getMetadata() {
  return {
    name: "SIMPLE Wallet",
    description: "Local-first non-custodial EVM wallet.",
    url: chrome.runtime.getURL("walletconnect-offscreen.html"),
    icons: [chrome.runtime.getURL("walletconnect-offscreen.html")],
  };
}

async function chromeStorageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  const response = await sendServiceWorkerMessage<{
    ok?: boolean;
    error?: string;
    value?: Record<string, unknown>;
  }>({
    type: "SIMPLE_WALLETCONNECT_STORAGE_GET",
    keys,
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Could not read extension storage.");
  }

  return response.value ?? {};
}

async function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  const response = await sendServiceWorkerMessage<{
    ok?: boolean;
    error?: string;
  }>({
    type: "SIMPLE_WALLETCONNECT_STORAGE_SET",
    items,
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Could not write extension storage.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function getOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function getFirstRequestParam(params: unknown): Record<string, unknown> {
  if (Array.isArray(params)) {
    return asRecord(params[0]);
  }

  return asRecord(params);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseEip155ChainId(chainId?: string): number | undefined {
  if (!chainId?.startsWith("eip155:")) {
    return undefined;
  }

  const parsed = Number(chainId.slice("eip155:".length));

  return Number.isFinite(parsed) ? parsed : undefined;
}

async function ensureWalletConnectRequestChainSelected(
  chainNamespace?: string,
): Promise<number | null> {
  const chainId = parseEip155ChainId(chainNamespace);

  if (!chainId) {
    return null;
  }

  const response = await sendServiceWorkerMessage<{
    ok?: boolean;
    error?: string;
    result?: unknown;
  }>({
    type: "SIMPLE_WALLETCONNECT_SET_SELECTED_CHAIN",
    chainId,
  });

  if (!response?.ok) {
    throw new Error(
      response?.error ?? `Failed to switch SIMPLE to WalletConnect chain ${chainId}.`,
    );
  }

  return chainId;
}






function isWalletWatchAssetParamsEmpty(params: unknown): boolean {
  if (params == null) {
    return true;
  }

  if (Array.isArray(params)) {
    return params.length === 0 || params.every((item) => isWalletWatchAssetParamsEmpty(item));
  }

  if (typeof params === "object") {
    return Object.keys(params as Record<string, unknown>).length === 0;
  }

  return false;
}

function getWalletWatchAssetIdentityForDedupe(
  params: unknown,
  chainNamespace?: string,
): {
  address: string;
  chainId: number;
  symbol?: string;
} | null {
  try {
    const payload = getWalletWatchAssetPayload(params);
    const options = payload.options;

    if (!options || typeof options !== "object") {
      return null;
    }

    const optionsRecord = options as Record<string, unknown>;
    const address =
      typeof optionsRecord.address === "string"
        ? optionsRecord.address.toLowerCase()
        : "";

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return null;
    }

    return {
      address,
      chainId: parseEip155ChainId(chainNamespace) ?? 1,
      symbol:
        typeof optionsRecord.symbol === "string"
          ? optionsRecord.symbol
          : undefined,
    };
  } catch {
    return null;
  }
}

async function isWalletWatchAssetAlreadyStored(
  params: unknown,
  chainNamespace?: string,
) {
  const identity = getWalletWatchAssetIdentityForDedupe(params, chainNamespace);

  if (!identity) {
    return false;
  }

  const stored = await chrome.storage.local.get(["watchedAssets"]);
  const current = Array.isArray(stored.watchedAssets) ? stored.watchedAssets : [];

  return current.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const record = item as Record<string, unknown>;

    const storedAddress =
      typeof record.address === "string"
        ? record.address.toLowerCase()
        : typeof record.contractAddress === "string"
          ? record.contractAddress.toLowerCase()
          : "";

    return Number(record.chainId) === identity.chainId && storedAddress === identity.address;
  });
}

async function respondWalletWatchAssetNoopSuccess(args: {
  walletKit: unknown;
  pendingRequest: WalletConnectPendingRequest;
  reason: string;
}) {
  await respondWalletConnectSuccess({
    walletKit: args.walletKit,
    topic: args.pendingRequest.topic,
    id: args.pendingRequest.id,
    result: true,
  });

  await clearPendingWalletConnectRequest();

  return {
    result: true,
    reason: args.reason,
  };
}

function getWalletWatchAssetPayload(params: unknown): Record<string, unknown> {
  const direct = Array.isArray(params) ? params[0] : params;

  if (direct && typeof direct === "object") {
    const record = direct as Record<string, unknown>;

    if ("type" in record || "options" in record) {
      return record;
    }

    const request = record.request;

    if (request && typeof request === "object") {
      const requestRecord = request as Record<string, unknown>;
      const requestParams = requestRecord.params;

      if (Array.isArray(requestParams) && requestParams[0] && typeof requestParams[0] === "object") {
        return requestParams[0] as Record<string, unknown>;
      }

      if (requestParams && typeof requestParams === "object") {
        return requestParams as Record<string, unknown>;
      }
    }
  }

  return {};
}

function parseWalletConnectWatchedAsset(
  params: unknown,
  chainNamespace?: string,
): {
  type: string;
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  image?: string;
} {
  const payload = getWalletWatchAssetPayload(params);
  const options = payload.options;

  if (!options || typeof options !== "object") {
    throw new Error("wallet_watchAsset options are missing.");
  }

  const optionsRecord = options as Record<string, unknown>;

  const type = typeof payload.type === "string" ? payload.type : "ERC20";
  const address = typeof optionsRecord.address === "string" ? optionsRecord.address : "";
  const symbol = typeof optionsRecord.symbol === "string" ? optionsRecord.symbol : "";
  const decimalsRaw = optionsRecord.decimals;
  const decimals =
    typeof decimalsRaw === "number"
      ? decimalsRaw
      : typeof decimalsRaw === "string"
        ? Number(decimalsRaw)
        : 18;

  const image = typeof optionsRecord.image === "string" ? optionsRecord.image : undefined;
  const chainId = parseEip155ChainId(chainNamespace) ?? 1;

  if (type !== "ERC20") {
    throw new Error(`Unsupported wallet_watchAsset type: ${type}`);
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid wallet_watchAsset token address: ${address}`);
  }

  if (!symbol.trim()) {
    throw new Error("wallet_watchAsset token symbol is missing.");
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`Invalid wallet_watchAsset token decimals: ${String(decimalsRaw)}`);
  }

  return {
    type,
    address,
    symbol,
    decimals,
    chainId,
    image,
  };
}

async function saveWalletConnectWatchedAsset(
  params: unknown,
  chainNamespace?: string,
) {
  const asset = parseWalletConnectWatchedAsset(params, chainNamespace);

  const stored = await chrome.storage.local.get(["watchedAssets"]);
  const current = Array.isArray(stored.watchedAssets) ? stored.watchedAssets : [];

  const normalizedAddress = asset.address.toLowerCase();

  const next = [
    ...current.filter((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const record = item as Record<string, unknown>;

      return !(
        Number(record.chainId) === asset.chainId &&
        typeof record.address === "string" &&
        record.address.toLowerCase() === normalizedAddress
      );
    }),
    {
      type: asset.type,
      address: asset.address,
      contractAddress: asset.address,
      symbol: asset.symbol,
      ticker: asset.symbol,
      decimals: asset.decimals,
      chainId: asset.chainId,
      image: asset.image,
      source: "walletconnect",
      addedAt: new Date().toISOString(),
    },
  ];

  await chrome.storage.local.set({
    watchedAssets: next,
  });

  return asset;
}

function parseWalletWatchAssetRequest(params: unknown, chainNamespace?: string): WatchedAsset {
  const request = Array.isArray(params) ? asRecord(params[0]) : asRecord(params);
  const type = getOptionalString(request, "type") ?? "ERC20";
  const options = asRecord(request.options);

  if (type.toUpperCase() !== "ERC20") {
    throw new Error(`Only ERC20 watchAsset requests are supported. Received: ${type}`);
  }

  const address = getOptionalString(options, "address");
  const symbol = getOptionalString(options, "symbol");
  const decimals = parseNumber(options.decimals);
  const image = getOptionalString(options, "image");
  const name = getOptionalString(options, "name");

  if (!address) {
    throw new Error("Token address is missing.");
  }

  if (!symbol) {
    throw new Error("Token symbol is missing.");
  }

  if (decimals === null || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals are invalid.");
  }

  const chainId = parseEip155ChainId(chainNamespace);
  const now = new Date().toISOString();

  return {
    id: `${chainId ?? "unknown"}:${address.toLowerCase()}`,
    type: "ERC20",
    chainId,
    chainNamespace,
    address,
    symbol,
    decimals,
    image,
    name,
    addedAt: now,
    updatedAt: now,
  };
}

async function saveWatchedAsset(asset: WatchedAsset): Promise<void> {
  const stored = await chromeStorageGet(WATCHED_ASSETS_KEY);
  const existing = Array.isArray(stored[WATCHED_ASSETS_KEY])
    ? (stored[WATCHED_ASSETS_KEY] as WatchedAsset[])
    : [];

  const previous = existing.find((item) => item.id === asset.id);

  const nextAsset: WatchedAsset = {
    ...asset,
    addedAt: previous?.addedAt ?? asset.addedAt,
    updatedAt: new Date().toISOString(),
  };

  await chromeStorageSet({
    [WATCHED_ASSETS_KEY]: [
      nextAsset,
      ...existing.filter((item) => item.id !== asset.id),
    ],
  });
}

function normalizeWalletConnectTransaction(params: unknown) {
  const tx = getFirstRequestParam(params);
  const to = getOptionalString(tx, "to");

  if (!to) {
    throw new Error("Transaction target address is missing.");
  }

  const transaction: {
    to: string;
    data?: string;
    value?: string;
    gas?: string;
    gasPrice?: string;
  } = {
    to,
  };

  const data = getOptionalString(tx, "data");
  const value = getOptionalString(tx, "value");
  const gas = getOptionalString(tx, "gas");
  const gasPrice = getOptionalString(tx, "gasPrice");

  if (data) transaction.data = data;
  if (value) transaction.value = value;
  if (gas) transaction.gas = gas;
  if (gasPrice) transaction.gasPrice = gasPrice;

  return transaction;
}

async function readPendingWalletConnectRequest(): Promise<WalletConnectPendingRequest | null> {
  const stored = await chromeStorageGet(PENDING_WALLETCONNECT_REQUEST_KEY);
  const value = stored[PENDING_WALLETCONNECT_REQUEST_KEY];
  const record = asRecord(value);
  const topic = typeof record.topic === "string" ? record.topic : "";
  const id = typeof record.id === "number" ? record.id : Number(record.id);
  const method = typeof record.method === "string" ? record.method : "";

  if (!topic || !Number.isFinite(id) || !method) {
    return null;
  }

  return {
    topic,
    id,
    method,
    params: record.params,
    chainId: typeof record.chainId === "string" ? record.chainId : undefined,
    receivedAt:
      typeof record.receivedAt === "string"
        ? record.receivedAt
        : new Date().toISOString(),
  };
}

async function savePendingWalletConnectRequest(request: WalletConnectPendingRequest) {
  await chromeStorageSet({
    [PENDING_WALLETCONNECT_REQUEST_KEY]: request,
  });
}

async function clearPendingWalletConnectRequest() {
  await chromeStorageSet({
    [PENDING_WALLETCONNECT_REQUEST_KEY]: null,
  });
}

// --- Session proposal: explicit approval helpers ---------------------------
// The pure allowlist / validation / sanitizer helpers live in
// ../core/walletconnect/wc-approval-policy (imported above); this file keeps
// only the chrome/WalletKit-bound orchestration.

async function buildSanitizedPendingProposal(
  id: number,
  proposal: any,
): Promise<SanitizedPendingProposal> {
  const metadata = proposal?.proposer?.metadata ?? {};

  // Best-effort: the selected address is display-only here. A locked wallet
  // must NOT block surfacing the proposal — the user unlocks at approve time.
  let address = "";
  try {
    address = (await getSelectedWalletAccount()).address;
  } catch {
    address = "";
  }

  const expiry =
    typeof proposal?.expiryTimestamp === "number" ? proposal.expiryTimestamp : undefined;

  return {
    id,
    peerName: sanitizeMetaString(metadata.name) ?? "Unknown dApp",
    peerUrl: sanitizePeerUrl(metadata.url) ?? "",
    peerIcon: sanitizePeerUrl(Array.isArray(metadata.icons) ? metadata.icons[0] : undefined),
    requestedChains: getApprovedEip155Chains(proposal),
    requiredMethods: collectNamespaceValues(proposal, "eip155", "methods", "required"),
    optionalMethods: getApprovedEip155Methods(proposal).filter((method) =>
      collectNamespaceValues(proposal, "eip155", "methods", "optional").includes(method),
    ),
    requestedTron: proposalRequestsTron(proposal),
    address,
    createdAt: new Date().toISOString(),
    expiry,
  };
}

async function readPendingWalletConnectProposal(): Promise<SanitizedPendingProposal | null> {
  const stored = await chromeStorageGet(PENDING_WALLETCONNECT_PROPOSAL_KEY);
  const record = asRecord(stored[PENDING_WALLETCONNECT_PROPOSAL_KEY]);
  const id = typeof record.id === "number" ? record.id : Number(record.id);

  if (!Number.isFinite(id)) {
    return null;
  }

  return {
    id,
    peerName: typeof record.peerName === "string" ? record.peerName : "Unknown dApp",
    peerUrl: typeof record.peerUrl === "string" ? record.peerUrl : "",
    peerIcon: typeof record.peerIcon === "string" ? record.peerIcon : undefined,
    requestedChains: Array.isArray(record.requestedChains)
      ? (record.requestedChains as string[])
      : [],
    requiredMethods: Array.isArray(record.requiredMethods)
      ? (record.requiredMethods as string[])
      : [],
    optionalMethods: Array.isArray(record.optionalMethods)
      ? (record.optionalMethods as string[])
      : [],
    requestedTron: record.requestedTron === true,
    address: typeof record.address === "string" ? record.address : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    expiry: typeof record.expiry === "number" ? record.expiry : undefined,
  };
}

async function savePendingWalletConnectProposal(proposal: SanitizedPendingProposal) {
  await chromeStorageSet({
    [PENDING_WALLETCONNECT_PROPOSAL_KEY]: proposal,
  });
}

async function clearPendingWalletConnectProposal() {
  await chromeStorageSet({
    [PENDING_WALLETCONNECT_PROPOSAL_KEY]: null,
  });
}

// Persist only a short, non-sensitive reason so the popup can explain a
// pre-approval rejection. Never store the proposal payload here.
async function recordProposalRejectionNotice(message: string) {
  await chromeStorageSet({
    [WALLETCONNECT_PROPOSAL_ERROR_KEY]: {
      message,
      createdAt: new Date().toISOString(),
    },
  });
}

function getSdkPendingProposal(walletKit: any, id: number): any | null {
  try {
    const pending = walletKit?.getPendingSessionProposals?.();

    if (pending && typeof pending === "object") {
      const match = Object.values(pending).find((entry: any) => Number(entry?.id) === id);

      return match ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

async function rejectWalletConnectSession(walletKit: any, id: number, message: string) {
  if (!Number.isFinite(id)) {
    return;
  }

  try {
    await walletKit.rejectSession?.({
      id,
      reason: {
        code: 5000,
        message,
      },
    });
  } catch (error) {
    console.error("WalletConnect session rejection failed:", error);
  }
}

function buildEmptyWalletCapabilities(params: unknown): Record<string, unknown> {
  if (!Array.isArray(params)) {
    return {};
  }

  const maybeChains = params.find((item) => Array.isArray(item));

  if (!Array.isArray(maybeChains)) {
    return {};
  }

  return Object.fromEntries(
    maybeChains
      .filter((chainId): chainId is string => typeof chainId === "string" && chainId.length > 0)
      .map((chainId) => [chainId, {}]),
  );
}

async function respondWalletConnectSuccess(input: {
  walletKit: any;
  topic: string;
  id: number;
  result: unknown;
}) {
  await input.walletKit.respondSessionRequest?.({
    topic: input.topic,
    response: {
      id: input.id,
      jsonrpc: "2.0",
      result: input.result,
    },
  });
}

function openApprovalWindow() {
  chrome.runtime.sendMessage(
    {
      type: "SIMPLE_OPEN_WALLETCONNECT_APPROVAL_WINDOW",
    },
    () => {
      void chrome.runtime.lastError?.message;
    },
  );
}

async function saveConnectedSiteFromProposal(proposal: any) {
  const metadata = proposal?.proposer?.metadata ?? {};
  const url = typeof metadata.url === "string" ? metadata.url : "";
  const origin = url || "walletconnect";
  const now = new Date().toISOString();

  const stored = await chromeStorageGet(CONNECTED_SITES_KEY);
  const existing = Array.isArray(stored[CONNECTED_SITES_KEY])
    ? (stored[CONNECTED_SITES_KEY] as ConnectedSite[])
    : [];

  const nextSite: ConnectedSite = {
    id: origin,
    origin,
    name: typeof metadata.name === "string" ? metadata.name : origin,
    iconUrl: Array.isArray(metadata.icons) && typeof metadata.icons[0] === "string"
      ? metadata.icons[0]
      : undefined,
    // TRON proposals get a TRON badge; other WC sessions show WalletConnect.
    type: proposalRequestsTron(proposal) ? "tron" : "walletconnect",
    connectedAt: existing.find((site) => site.id === origin)?.connectedAt ?? now,
    lastUsedAt: now,
  };

  const nextSites = [
    nextSite,
    ...existing.filter((site) => site.id !== origin),
  ];

  await chromeStorageSet({
    [CONNECTED_SITES_KEY]: nextSites,
  });
}

async function getSelectedWalletAccount() {
  const response = await sendServiceWorkerMessage<{
    ok?: boolean;
    error?: string;
    account?: {
      address: string;
      chainId: number;
    };
  }>({
    type: "SIMPLE_WALLETCONNECT_GET_SELECTED_ACCOUNT",
  });

  if (!response?.ok || !response.account) {
    throw new Error(response?.error ?? "No selected SIMPLE account.");
  }

  return response.account;
}

// TRON account (base58 T… + hex 41…) for the selected wallet account. Resolved
// in the service worker via walletService.getSelectedTronAccountInfo() — the
// private key never reaches the offscreen engine.
async function getSelectedTronAccount() {
  const response = await sendServiceWorkerMessage<{
    ok?: boolean;
    error?: string;
    account?: {
      base58: string;
      hex: string;
    };
  }>({
    type: "SIMPLE_WALLETCONNECT_GET_SELECTED_TRON_ACCOUNT",
  });

  if (!response?.ok || !response.account) {
    throw new Error(response?.error ?? "No selected TRON account.");
  }

  return response.account;
}

// Approved eip155 events: the base set plus any requested events (events are
// low-risk and not part of the method allowlist).
function getRequestedEvents(proposal: any): string[] {
  return uniqueStrings([
    ...DEFAULT_EVENTS,
    ...collectNamespaceValues(proposal, "eip155", "events", "required"),
    ...collectNamespaceValues(proposal, "eip155", "events", "optional"),
  ]);
}

// --- TRON namespace builder (isolated; never touched by the eip155 path) -------

function getRequestedTronValues(
  proposal: any,
  key: "chains" | "methods" | "events",
): string[] {
  return uniqueStrings([
    ...collectNamespaceValues(proposal, "tron", key, "required"),
    ...collectNamespaceValues(proposal, "tron", key, "optional"),
  ]);
}

// Build the approved `tron` namespace, or return null when the proposal does not
// request TRON (in which case behaviour is exactly as before — eip155 only).
// Throws a clear error (→ session rejected) when a REQUIRED tron chain or method
// is outside what SIMPL supports.
async function buildTronNamespace(proposal: any) {
  if (!proposalRequestsTron(proposal)) {
    return null;
  }

  // Only TRON Mainnet is supported. Reject if a different chain is required.
  const requiredChains = Array.isArray(proposal?.requiredNamespaces?.tron?.chains)
    ? (proposal.requiredNamespaces.tron.chains as string[])
    : [];
  const unsupportedChain = requiredChains.find((chain) => chain !== TRON_WC_CHAIN);
  if (unsupportedChain) {
    throw new Error(
      `Unsupported TRON chain requested: ${unsupportedChain}. Only ${TRON_WC_CHAIN} is supported.`,
    );
  }

  // Reject if a REQUIRED method is one we cannot service.
  const requiredMethods = Array.isArray(proposal?.requiredNamespaces?.tron?.methods)
    ? (proposal.requiredNamespaces.tron.methods as string[])
    : [];
  const unsupportedMethod = requiredMethods.find(
    (method) => !SUPPORTED_TRON_METHODS.has(method),
  );
  if (unsupportedMethod) {
    throw new Error(`Unsupported TRON method requested: ${unsupportedMethod}.`);
  }

  const tron = await getSelectedTronAccount();

  return {
    chains: [TRON_WC_CHAIN],
    methods: DEFAULT_TRON_METHODS,
    events: uniqueStrings([
      ...DEFAULT_TRON_EVENTS,
      ...getRequestedTronValues(proposal, "events"),
    ]),
    // CAIP-10 account, e.g. tron:0x2b6653dc:T… — TRON base58, never an EVM 0x.
    accounts: [`${TRON_WC_CHAIN}:${tron.base58}`],
  };
}

// Relay an approved TRON request (sign message / sign tx / send tx) to the
// signing layer in the service worker and respond to the dApp with the result.
// The private key, message and signature never enter this engine — only the
// service-worker round-trip result. Stores a non-sensitive request shape only.
async function approveTronWalletConnectRequest(input: {
  walletKit: any;
  pendingRequest: WalletConnectPendingRequest;
  password: string | undefined;
  serviceWorkerType: string;
}) {
  const { walletKit, pendingRequest, password, serviceWorkerType } = input;

  if (!password?.trim()) {
    throw new Error("Wallet password is required.");
  }

  const response = await sendServiceWorkerMessage<{
    ok?: boolean;
    error?: string;
    result?: unknown;
  }>({
    type: serviceWorkerType,
    password: password.trim(),
    params: pendingRequest.params,
  });

  if (
    !response?.ok ||
    response.result === undefined ||
    response.result === null
  ) {
    throw new Error(response?.error ?? "TRON request failed.");
  }

  await (walletKit as any).respondSessionRequest?.({
    topic: pendingRequest.topic,
    response: {
      id: pendingRequest.id,
      jsonrpc: "2.0",
      result: response.result,
    },
  });

  await clearPendingWalletConnectRequest();

  return { result: response.result };
}

async function buildNamespacesForProposal(proposal: any) {
  const selected = await getSelectedWalletAccount();
  const chains = getApprovedEip155Chains(proposal);
  const methods = getApprovedEip155Methods(proposal);
  const events = getRequestedEvents(proposal);
  const accounts = chains.map((chain) => `${chain}:${selected.address}`);

  const namespaces: Record<string, unknown> = {
    eip155: {
      chains,
      methods,
      events,
      accounts,
    },
  };

  // Additive: include a TRON namespace when the dApp asks for one. The eip155
  // object above is unchanged; this only adds a sibling `tron` key.
  const tronNamespace = await buildTronNamespace(proposal);
  if (tronNamespace) {
    namespaces.tron = tronNamespace;
  }

  return namespaces;
}

async function pairWalletKit(uri: string) {
  const walletKit = await getWalletKit();

  const pair = (walletKit as any).core?.pairing?.pair;

  if (typeof pair === "function") {
    await pair.call((walletKit as any).core?.pairing, { uri });
    return;
  }

  if (typeof (walletKit as any).pair === "function") {
    await (walletKit as any).pair({ uri });
    return;
  }

  throw new Error("WalletConnect pair method is not available.");
}

async function approvePendingWalletConnectRequest(password?: string) {
  const walletKit = await getWalletKit();
  const pendingRequest = await readPendingWalletConnectRequest();

  if (!pendingRequest) {
    throw new Error("No pending WalletConnect request.");
  }

  if (pendingRequest.method === "eth_sendTransaction") {
    await ensureWalletConnectRequestChainSelected(pendingRequest.chainId);

    if (!password?.trim()) {
      throw new Error("Wallet password is required.");
    }

    const transaction = normalizeWalletConnectTransaction(pendingRequest.params);

    const response = await sendServiceWorkerMessage<{
      ok?: boolean;
      error?: string;
      result?: {
        hash: string;
      };
    }>({
      type: "SIMPLE_WALLETCONNECT_SEND_PREPARED_TRANSACTION",
      password: password.trim(),
      transaction,
    });

    if (!response?.ok || !response.result?.hash) {
      throw new Error(response?.error ?? "Transaction submission failed.");
    }

    const result = response.result;

    await (walletKit as any).respondSessionRequest?.({
      topic: pendingRequest.topic,
      response: {
        id: pendingRequest.id,
        jsonrpc: "2.0",
        result: result.hash,
      },
    });

    await clearPendingWalletConnectRequest();

    return {
      result: result.hash,
    };
  }

  if (pendingRequest.method === "personal_sign") {
    const trimmedPassword = password?.trim();

    if (!trimmedPassword) {
      throw new Error("Password is required.");
    }

    const response = await sendServiceWorkerMessage<{
      ok?: boolean;
      error?: string;
      result?: {
        signature: string;
      };
    }>({
      type: "SIMPLE_WALLETCONNECT_PERSONAL_SIGN",
      password: trimmedPassword,
      params: pendingRequest.params,
    });

    if (!response?.ok || !response.result?.signature) {
      throw new Error(response?.error ?? "Message signing failed.");
    }

    await respondWalletConnectSuccess({
      walletKit,
      topic: pendingRequest.topic,
      id: pendingRequest.id,
      result: response.result.signature,
    });

    await clearPendingWalletConnectRequest();

    return {
      result: response.result.signature,
    };
  }

  if (pendingRequest.method === "eth_signTypedData_v4") {
    if (!password?.trim()) {
      throw new Error("Wallet password is required.");
    }

    const response = await sendServiceWorkerMessage<{
      ok?: boolean;
      error?: string;
      result?: {
        signature: string;
      };
    }>({
      type: "SIMPLE_WALLETCONNECT_SIGN_TYPED_DATA_V4",
      password: password.trim(),
      params: pendingRequest.params,
    });

    if (!response?.ok || !response.result?.signature) {
      throw new Error(response?.error ?? "Typed data signing failed.");
    }

    const result = response.result;

    await (walletKit as any).respondSessionRequest?.({
      topic: pendingRequest.topic,
      response: {
        id: pendingRequest.id,
        jsonrpc: "2.0",
        result: result.signature,
      },
    });

    await clearPendingWalletConnectRequest();

    return {
      result: result.signature,
    };
  }

  if (pendingRequest.method === "wallet_watchAsset") {
    if (isWalletWatchAssetParamsEmpty(pendingRequest.params)) {
      return await respondWalletWatchAssetNoopSuccess({
        walletKit,
        pendingRequest,
        reason: "empty_wallet_watchAsset_params",
      });
    }

    if (
      await isWalletWatchAssetAlreadyStored(
        pendingRequest.params,
        pendingRequest.chainId,
      )
    ) {
      return await respondWalletWatchAssetNoopSuccess({
        walletKit,
        pendingRequest,
        reason: "asset_already_watched",
      });
    }


    const watchedAsset = await saveWalletConnectWatchedAsset(
      pendingRequest.params,
      pendingRequest.chainId,
    );

    await respondWalletConnectSuccess({
      walletKit,
      topic: pendingRequest.topic,
      id: pendingRequest.id,
      result: true,
    });

    await clearPendingWalletConnectRequest();

    return {
      result: true,
      watchedAsset,
    };
  }

  if (pendingRequest.method === "wallet_switchEthereumChain") {
    await (walletKit as any).respondSessionRequest?.({
      topic: pendingRequest.topic,
      response: {
        id: pendingRequest.id,
        jsonrpc: "2.0",
        result: null,
      },
    });

    await clearPendingWalletConnectRequest();

    return {
      result: null,
    };
  }

  // --- TRON: sign an unsigned transaction (sign-only; NOT broadcast) ---------
  if (pendingRequest.method === "tron_signTransaction") {
    return approveTronWalletConnectRequest({
      walletKit,
      pendingRequest,
      password,
      serviceWorkerType: "SIMPLE_WALLETCONNECT_TRON_SIGN_TRANSACTION",
    });
  }

  // --- TRON: sign a message (local ECDSA; NOT broadcast) ---------------------
  if (pendingRequest.method === "tron_signMessage") {
    return approveTronWalletConnectRequest({
      walletKit,
      pendingRequest,
      password,
      serviceWorkerType: "SIMPLE_WALLETCONNECT_TRON_SIGN_MESSAGE",
    });
  }

  // --- TRON: sign AND broadcast a transaction --------------------------------
  if (pendingRequest.method === "tron_sendTransaction") {
    return approveTronWalletConnectRequest({
      walletKit,
      pendingRequest,
      password,
      serviceWorkerType: "SIMPLE_WALLETCONNECT_TRON_SEND_TRANSACTION",
    });
  }

  throw new Error(`${pendingRequest.method} approval is not supported yet.`);
}

async function rejectPendingWalletConnectRequest() {
  const walletKit = await getWalletKit();
  const pendingRequest = await readPendingWalletConnectRequest();

  if (!pendingRequest) {
    return;
  }

  if (pendingRequest.method === "wallet_watchAsset") {
    await (walletKit as any).respondSessionRequest?.({
      topic: pendingRequest.topic,
      response: {
        id: pendingRequest.id,
        jsonrpc: "2.0",
        result: false,
      },
    });

    await clearPendingWalletConnectRequest();
    return;
  }

  await (walletKit as any).respondSessionRequest?.({
    topic: pendingRequest.topic,
    response: {
      id: pendingRequest.id,
      jsonrpc: "2.0",
      error: {
        code: 4001,
        message: "User rejected the request.",
      },
    },
  });

  await clearPendingWalletConnectRequest();
}

// Approve a pending session proposal. Called ONLY in response to an explicit
// user Approve from the approval UI — never automatically. The connected site is
// persisted strictly AFTER a successful approveSession, so a failed/expired
// approval never leaves a phantom connection behind.
async function approvePendingWalletConnectProposal() {
  const walletKit = await getWalletKit();
  const pending = await readPendingWalletConnectProposal();

  if (!pending) {
    throw new Error("No pending WalletConnect proposal.");
  }

  const proposal = proposalCache.get(pending.id) ?? getSdkPendingProposal(walletKit, pending.id);

  if (!proposal) {
    await clearPendingWalletConnectProposal();
    throw new Error("This WalletConnect request expired. Reconnect from the dApp.");
  }

  if (isProposalExpired(pending.expiry, Date.now())) {
    proposalCache.delete(pending.id);
    await clearPendingWalletConnectProposal();
    await rejectWalletConnectSession(walletKit, pending.id, "Session proposal expired.");
    throw new Error("This WalletConnect request expired. Reconnect from the dApp.");
  }

  // Defense in depth: re-validate at approve time so a proposal that somehow
  // reached here with an unsupported REQUIRED chain/method is rejected, not
  // approved.
  assertEip155ProposalSupported(proposal);
  assertTronProposalSupported(proposal);

  const namespaces = await buildNamespacesForProposal(proposal);

  await (walletKit as any).approveSession?.({
    id: pending.id,
    namespaces,
  });

  // Only now — after approveSession resolved — record the connected site.
  await saveConnectedSiteFromProposal(proposal);

  proposalCache.delete(pending.id);
  await clearPendingWalletConnectProposal();

  return { ok: true };
}

// Reject a pending session proposal on explicit user Reject (or window close /
// timeout). No session and no connected site are ever created.
async function rejectPendingWalletConnectProposal() {
  const walletKit = await getWalletKit();
  const pending = await readPendingWalletConnectProposal();

  if (!pending) {
    return;
  }

  proposalCache.delete(pending.id);
  await clearPendingWalletConnectProposal();
  await rejectWalletConnectSession(walletKit, pending.id, "User rejected the connection.");
}

async function getWalletKit() {
  if (walletKitPromise) {
    return walletKitPromise;
  }

  const projectId = getProjectId();

  if (!projectId) {
    throw new Error("VITE_WALLETCONNECT_PROJECT_ID is missing.");
  }

  const core = new Core({
    projectId,
    customStoragePrefix: "simple-walletconnect-offscreen",
  } as any);

  walletKitPromise = WalletKit.init({
    core,
    metadata: getMetadata(),
  });

  const walletKit = await walletKitPromise;

  // Explicit approval model: a session proposal is NEVER auto-approved. We
  // validate it, persist a sanitized snapshot, and open the approval window.
  // The session is created only later, from an explicit user Approve
  // (approvePendingWalletConnectProposal).
  walletKit.on("session_proposal", async (event: any) => {
    const proposalId = Number(event?.id);

    try {
      const proposal = event.params;

      // Reject up-front (no approval surface) when a REQUIRED chain/method is
      // outside what SIMPL supports — for both eip155 and tron namespaces.
      assertEip155ProposalSupported(proposal);
      assertTronProposalSupported(proposal);

      proposalCache.set(proposalId, proposal);

      const sanitized = await buildSanitizedPendingProposal(proposalId, proposal);
      await savePendingWalletConnectProposal(sanitized);

      openApprovalWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Session proposal rejected.";

      // Log only the reason — never the proposal payload.
      console.error("WalletConnect session proposal rejected:", message);

      proposalCache.delete(proposalId);
      await clearPendingWalletConnectProposal();
      await recordProposalRejectionNotice(message);
      await rejectWalletConnectSession(walletKit, proposalId, message);
    }
  });

  // If the SDK expires a pending proposal before the user acts, drop our
  // sanitized copy so no stale Approve surface lingers.
  walletKit.on("proposal_expire", async (event: any) => {
    const expiredId = Number(event?.id);

    if (Number.isFinite(expiredId)) {
      proposalCache.delete(expiredId);
    }

    const pending = await readPendingWalletConnectProposal();

    if (pending && (!Number.isFinite(expiredId) || pending.id === expiredId)) {
      await clearPendingWalletConnectProposal();
    }
  });

  walletKit.on("session_request", async (event: any) => {
    const topic = String(event.topic ?? "");
    const id = Number(event.id ?? event.params?.request?.id);
    const request = event.params?.request ?? event.request ?? {};
    const method = String(request.method ?? "");
    const params = request.params ?? [];
    const chainId =
      typeof event.params?.chainId === "string" ? event.params.chainId : undefined;

    if (!topic || !Number.isFinite(id) || !method) {
      return;
    }

    if (method === "wallet_getCapabilities") {
      await respondWalletConnectSuccess({
        walletKit,
        topic,
        id,
        result: buildEmptyWalletCapabilities(params),
      });

      return;
    }

    // Reject any method that has no request handler + approval UX immediately,
    // instead of opening an approval window that could never succeed. This also
    // hard-blocks blind-sign methods (e.g. eth_sign) even if a hostile dApp
    // sends them outside the approved namespace.
    if (!HANDLED_REQUEST_METHODS.has(method)) {
      await (walletKit as any).respondSessionRequest?.({
        topic,
        response: {
          id,
          jsonrpc: "2.0",
          error: {
            code: 4200,
            message: `Method not supported: ${method}.`,
          },
        },
      });

      return;
    }

    const pendingRequest: WalletConnectPendingRequest = {
      topic,
      id,
      method,
      params,
      chainId,
      receivedAt: new Date().toISOString(),
    };

    await savePendingWalletConnectRequest(pendingRequest);
    openApprovalWindow();
  });

  walletKit.on("session_delete", async () => {
    await clearPendingWalletConnectRequest();
    await clearPendingWalletConnectProposal();
  });

  console.log("SIMPLE WalletConnect offscreen engine started.");

  chrome.runtime.sendMessage(
    {
      type: "SIMPLE_WALLETCONNECT_ENGINE_READY",
    },
    () => {
      void chrome.runtime.lastError?.message;
    },
  );

  return walletKit;
}

chrome.runtime.onMessage.addListener(
  (
    message: SimpleRuntimeMessage,
    _sender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message?.type === "SIMPLE_WALLETCONNECT_ENGINE_PING") {
      void getWalletKit()
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error("WalletConnect engine init failed:", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === "SIMPLE_WALLETCONNECT_PAIR") {
      void getWalletKit()
        .then(async () => {
          const uri = typeof message.uri === "string" ? message.uri.trim() : "";

          if (!uri.startsWith("wc:")) {
            throw new Error("Paste a valid WalletConnect URI that starts with wc:.");
          }

          await pairWalletKit(uri);

          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error("WalletConnect pair failed:", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === "SIMPLE_WALLETCONNECT_GET_PENDING_PROPOSAL") {
      void readPendingWalletConnectProposal()
        .then((proposal) => {
          sendResponse({ ok: true, proposal });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === "SIMPLE_WALLETCONNECT_APPROVE_PROPOSAL") {
      void approvePendingWalletConnectProposal()
        .then((result) => {
          sendResponse({ ok: true, result });
        })
        .catch((error) => {
          console.error("WalletConnect proposal approval failed:", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === "SIMPLE_WALLETCONNECT_REJECT_PROPOSAL") {
      void rejectPendingWalletConnectProposal()
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error("WalletConnect proposal rejection failed:", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === "SIMPLE_WALLETCONNECT_APPROVE_REQUEST") {
      void approvePendingWalletConnectRequest(message.password)
        .then((result) => {
          sendResponse({
            ok: true,
            result,
          });
        })
        .catch((error) => {
          console.error("WalletConnect request approval failed:", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === "SIMPLE_WALLETCONNECT_REJECT_REQUEST") {
      void rejectPendingWalletConnectRequest()
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error("WalletConnect request rejection failed:", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    return false;
  },
);

void getWalletKit().catch((error) => {
  console.error("WalletConnect offscreen engine failed to start:", error);
});
