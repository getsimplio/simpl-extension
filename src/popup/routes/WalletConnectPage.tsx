import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { walletService } from "../../core/wallet/wallet.service";
type WalletConnectPageProps = {
  onBack: () => void;
  onConnected?: () => void | Promise<void>;
};

type ConnectedSite = {
  id: string;
  origin: string;
  name?: string;
  iconUrl?: string;
  connectedAt?: string;
  lastUsedAt?: string;
};

type WalletConnectProposal = {
  id: number;
  params: {
    id?: number;
    proposer?: {
      metadata?: {
        name?: string;
        description?: string;
        url?: string;
        icons?: string[];
      };
    };
    requiredNamespaces?: Record<string, WalletConnectNamespace>;
    optionalNamespaces?: Record<string, WalletConnectNamespace>;
  };
};

type WalletConnectNamespace = {
  chains?: string[];
  methods?: string[];
  events?: string[];
};

type WalletConnectPendingRequest = {
  topic: string;
  id: number;
  method: string;
  params: unknown;
};

type WalletKitClient = {
  on?: (event: string, handler: (event: any) => void) => void;
  off?: (event: string, handler: (event: any) => void) => void;
  pair?: (params: { uri: string }) => Promise<unknown>;
  approveSession?: (params: { id: number; namespaces: Record<string, unknown> }) => Promise<unknown>;
  rejectSession?: (params: { id: number; reason: unknown }) => Promise<unknown>;
  respondSessionRequest?: (params: {
    topic: string;
    response: {
      id: number;
      jsonrpc: "2.0";
      result?: unknown;
      error?: {
        code: number;
        message: string;
      };
    };
  }) => Promise<unknown>;
  core?: {
    pairing?: {
      pair?: (params: { uri: string }) => Promise<unknown>;
    };
  };
};

type WalletSnapshot = {
  address: string;
  chainId: number;
};

const CONNECTED_SITES_KEY = "connectedSites";
const PENDING_WALLETCONNECT_REQUEST_KEY = "pendingWalletConnectRequest";

const WALLETCONNECT_METHODS = [
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "net_version",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_getCapabilities",
] as const;

const WALLETCONNECT_EVENTS = ["accountsChanged", "chainChanged"] as const;

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1L11 4.9" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2.1 2.1a5 5 0 0 0 7.1 7.1L13 19.1" />
    </svg>
  );
}

function getChromeStorageLocal() {
  return (globalThis as unknown as {
    chrome?: {
      storage?: {
        local?: {
          get?: (
            keys: string[] | string | null,
            callback: (items: Record<string, unknown>) => void,
          ) => void;
          set?: (items: Record<string, unknown>, callback?: () => void) => void;
        };
      };
    };
  }).chrome?.storage?.local;
}

function chromeStorageGet(keys: string[] | string | null): Promise<Record<string, unknown>> {
  const storage = getChromeStorageLocal();
  const get = storage?.get;

  if (!storage || typeof get !== "function") {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    try {
      get.call(storage, keys, (items: Record<string, unknown>) => {
        resolve(items ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  const storage = getChromeStorageLocal();
  const set = storage?.set;

  if (!storage || typeof set !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      set.call(storage, items, () => resolve());
    } catch {
      resolve();
    }
  });
}

function safeParsePendingWalletConnectRequest(
  value: unknown,
): WalletConnectPendingRequest | null {
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
  };
}

async function readPendingWalletConnectRequest(): Promise<WalletConnectPendingRequest | null> {
  const stored = await chromeStorageGet(PENDING_WALLETCONNECT_REQUEST_KEY);
  const fromChrome = safeParsePendingWalletConnectRequest(
    stored[PENDING_WALLETCONNECT_REQUEST_KEY],
  );

  if (fromChrome) {
    return fromChrome;
  }

  try {
    const raw = localStorage.getItem(PENDING_WALLETCONNECT_REQUEST_KEY);
    return safeParsePendingWalletConnectRequest(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}

async function savePendingWalletConnectRequest(request: WalletConnectPendingRequest) {
  await chromeStorageSet({
    [PENDING_WALLETCONNECT_REQUEST_KEY]: request,
  });

  try {
    localStorage.setItem(PENDING_WALLETCONNECT_REQUEST_KEY, JSON.stringify(request));
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }
}

async function clearPendingWalletConnectRequest() {
  await chromeStorageSet({
    [PENDING_WALLETCONNECT_REQUEST_KEY]: null,
  });

  try {
    localStorage.removeItem(PENDING_WALLETCONNECT_REQUEST_KEY);
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }
}

function sendWalletConnectEngineMessage<TResponse = { ok?: boolean; error?: string }>(
  message: Record<string, unknown>,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      chrome?: {
        runtime?: {
          sendMessage?: (
            message: unknown,
            callback?: (response?: TResponse) => void,
          ) => void;
          lastError?: {
            message?: string;
          };
        };
      };
    }).chrome?.runtime;

    if (typeof runtime?.sendMessage !== "function") {
      reject(new Error("Chrome runtime messaging is not available."));
      return;
    }

    runtime.sendMessage(message, (response?: TResponse) => {
      const lastError = runtime.lastError?.message;

      if (lastError) {
        reject(new Error(lastError));
        return;
      }

      resolve(response as TResponse);
    });
  });
}

function openWalletConnectApprovalWindow() {
  const runtime = (globalThis as unknown as {
    chrome?: {
      runtime?: {
        sendMessage?: (
          message: unknown,
          callback?: (response?: unknown) => void,
        ) => void;
        lastError?: {
          message?: string;
        };
      };
    };
  }).chrome?.runtime;

  if (typeof runtime?.sendMessage !== "function") {
    return;
  }

  try {
    runtime.sendMessage(
      {
        type: "SIMPLE_OPEN_WALLETCONNECT_APPROVAL_WINDOW",
      },
      () => {
        // Access lastError to avoid unchecked runtime error noise.
        void runtime.lastError?.message;
      },
    );
  } catch {
    // Approval window auto-open is best-effort.
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function safeParseConnectedSites(value: unknown): ConnectedSite[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sites: ConnectedSite[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const origin = typeof record.origin === "string" ? record.origin.trim() : "";

    if (!origin) {
      continue;
    }

    const site: ConnectedSite = {
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id
          : origin,
      origin,
    };

    if (typeof record.name === "string" && record.name.trim()) {
      site.name = record.name;
    }

    if (typeof record.iconUrl === "string" && record.iconUrl.trim()) {
      site.iconUrl = record.iconUrl;
    }

    if (typeof record.connectedAt === "string" && record.connectedAt.trim()) {
      site.connectedAt = record.connectedAt;
    }

    if (typeof record.lastUsedAt === "string" && record.lastUsedAt.trim()) {
      site.lastUsedAt = record.lastUsedAt;
    }

    sites.push(site);
  }

  return sites;
}

async function readConnectedSites(): Promise<ConnectedSite[]> {
  const stored = await chromeStorageGet(CONNECTED_SITES_KEY);
  const fromChrome = safeParseConnectedSites(stored[CONNECTED_SITES_KEY]);

  if (fromChrome.length > 0) {
    return fromChrome;
  }

  try {
    const raw = localStorage.getItem(CONNECTED_SITES_KEY);
    return safeParseConnectedSites(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

async function writeConnectedSites(sites: ConnectedSite[]) {
  await chromeStorageSet({
    [CONNECTED_SITES_KEY]: sites,
  });

  try {
    localStorage.setItem(CONNECTED_SITES_KEY, JSON.stringify(sites));
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }
}

async function saveConnectedSite(site: ConnectedSite) {
  const currentSites = await readConnectedSites();
  const now = new Date().toISOString();

  const nextSite: ConnectedSite = {
    ...site,
    connectedAt: site.connectedAt ?? now,
    lastUsedAt: now,
  };

  const nextSites = [
    nextSite,
    ...currentSites.filter((item) => item.id !== nextSite.id && item.origin !== nextSite.origin),
  ];

  await writeConnectedSites(nextSites);
}

function normalizeOrigin(value?: string): string {
  if (!value) {
    return "walletconnect://unknown";
  }

  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function getProposalSite(proposal: WalletConnectProposal): ConnectedSite {
  const metadata = proposal.params.proposer?.metadata;
  const origin = normalizeOrigin(metadata?.url);
  const iconUrl = metadata?.icons?.find(Boolean);

  return {
    id: origin,
    origin,
    name: metadata?.name,
    iconUrl,
  };
}

function getNamespace(proposal: WalletConnectProposal, key: string): WalletConnectNamespace {
  return {
    ...(proposal.params.optionalNamespaces?.[key] ?? {}),
    ...(proposal.params.requiredNamespaces?.[key] ?? {}),
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getRequestedEip155Chains(proposal: WalletConnectProposal, fallbackChainId: number): string[] {
  const required = proposal.params.requiredNamespaces?.eip155?.chains ?? [];
  const optional = proposal.params.optionalNamespaces?.eip155?.chains ?? [];
  const chains = uniqueStrings([...required, ...optional]);

  return chains.length > 0 ? chains : [`eip155:${fallbackChainId}`];
}

function getRequestedEip155Methods(proposal: WalletConnectProposal): string[] {
  const required = proposal.params.requiredNamespaces?.eip155?.methods ?? [];
  const optional = proposal.params.optionalNamespaces?.eip155?.methods ?? [];

  return uniqueStrings([...required, ...optional, ...WALLETCONNECT_METHODS]);
}

function getRequestedEip155Events(proposal: WalletConnectProposal): string[] {
  const required = proposal.params.requiredNamespaces?.eip155?.events ?? [];
  const optional = proposal.params.optionalNamespaces?.eip155?.events ?? [];

  return uniqueStrings([...required, ...optional, ...WALLETCONNECT_EVENTS]);
}

function getProjectId(): string {
  return String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();
}

function getSelectedAddressFromWalletState(walletState: Record<string, unknown>): string {
  const selectedAccountId =
    typeof walletState.selectedAccountId === "string"
      ? walletState.selectedAccountId
      : typeof asRecord(walletState.accounts).selectedAccountId === "string"
        ? String(asRecord(walletState.accounts).selectedAccountId)
        : "";

  const accountLists = [
    walletState.accounts,
    asRecord(walletState.accounts).items,
    asRecord(walletState.accounts).list,
  ];

  for (const list of accountLists) {
    if (!Array.isArray(list)) {
      continue;
    }

    const records = list
      .map((item) => asRecord(item))
      .filter((item) => typeof item.address === "string");

    const selected = records.find((item) => {
      return (
        selectedAccountId &&
        (item.id === selectedAccountId || item.accountId === selectedAccountId)
      );
    });

    const fallback = selected ?? records[0];

    if (typeof fallback?.address === "string" && fallback.address) {
      return fallback.address;
    }
  }

  const selectedAccount = asRecord(walletState.selectedAccount);

  if (typeof selectedAccount.address === "string" && selectedAccount.address) {
    return selectedAccount.address;
  }

  throw new Error("Selected account was not found.");
}

function getSelectedChainIdFromWalletState(walletState: Record<string, unknown>): number {
  const chainId =
    typeof walletState.selectedChainId === "number"
      ? walletState.selectedChainId
      : typeof walletState.chainId === "number"
        ? walletState.chainId
        : 1;

  return Number.isFinite(chainId) && chainId > 0 ? chainId : 1;
}

async function readWalletSnapshot(): Promise<WalletSnapshot> {
  const stored = await chromeStorageGet(["walletState"]);
  const walletState = asRecord(stored.walletState);

  if (Object.keys(walletState).length === 0) {
    try {
      const raw = localStorage.getItem("walletState");
      const parsed = raw ? JSON.parse(raw) : null;
      Object.assign(walletState, asRecord(parsed));
    } catch {
      // Ignore malformed local storage.
    }
  }

  return {
    address: getSelectedAddressFromWalletState(walletState),
    chainId: getSelectedChainIdFromWalletState(walletState),
  };
}

async function createWalletKitClient(): Promise<WalletKitClient> {
  const projectId = getProjectId();

  if (!projectId) {
    throw new Error("WalletConnect Project ID is missing.");
  }

  const [{ Core }, { WalletKit }] = await Promise.all([
    import("@walletconnect/core"),
    import("@reown/walletkit"),
  ]);

  const core = new Core({
    projectId,
  });

  const client = await WalletKit.init({
    core,
    metadata: {
      name: "SIMPLE",
      description: "SIMPLE non-custodial wallet",
      url: "https://diasoft.tech",
      icons: [],
    },
  });

  return client as WalletKitClient;
}

async function pairWalletKit(client: WalletKitClient, uri: string) {
  if (typeof client.pair === "function") {
    await client.pair({ uri });
    return;
  }

  const pair = client.core?.pairing?.pair;

  if (typeof pair === "function") {
    await pair.call(client.core?.pairing, { uri });
    return;
  }

  throw new Error("WalletConnect pair method is not available.");
}

async function buildApprovedNamespaces(
  proposal: WalletConnectProposal,
  snapshot: WalletSnapshot,
): Promise<Record<string, unknown>> {
  const { buildApprovedNamespaces: buildNamespaces } = await import("@walletconnect/utils");

  const chains = getRequestedEip155Chains(proposal, snapshot.chainId);
  const methods = getRequestedEip155Methods(proposal);
  const events = getRequestedEip155Events(proposal);
  const accounts = chains.map((chain) => `${chain}:${snapshot.address}`);

  return buildNamespaces({
    proposal: proposal.params as any,
    supportedNamespaces: {
      eip155: {
        chains,
        methods,
        events,
        accounts,
      },
    },
  }) as Record<string, unknown>;
}

async function rejectWalletConnectSession(client: WalletKitClient, proposalId: number) {
  if (typeof client.rejectSession !== "function") {
    return;
  }

  const { getSdkError } = await import("@walletconnect/utils");

  await client.rejectSession({
    id: proposalId,
    reason: getSdkError("USER_REJECTED"),
  });
}

function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function getJsonRpcResult(method: string, snapshot: WalletSnapshot): unknown {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [snapshot.address];

    case "eth_chainId":
      return toHexChainId(snapshot.chainId);

    case "net_version":
      return String(snapshot.chainId);

    case "wallet_getCapabilities":
      return {
        [toHexChainId(snapshot.chainId)]: {},
      };

    default:
      throw new Error(`${method} is not supported yet.`);
  }
}

type WalletConnectPreparedTransaction = {
  to: string;
  data?: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
};

function getFirstRequestParam(params: unknown): Record<string, unknown> {
  if (Array.isArray(params)) {
    return asRecord(params[0]);
  }

  return asRecord(params);
}

function getOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function normalizeWalletConnectTransaction(params: unknown): WalletConnectPreparedTransaction {
  const tx = getFirstRequestParam(params);
  const to = getOptionalString(tx, "to");

  if (!to) {
    throw new Error("Transaction target address is missing.");
  }

  const transaction: WalletConnectPreparedTransaction = {
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

function getWalletConnectTransactionChainId(params: unknown): number | null {
  const tx = getFirstRequestParam(params);
  const rawChainId = tx.chainId;

  if (typeof rawChainId !== "string" && typeof rawChainId !== "number") {
    return null;
  }

  const chainId =
    typeof rawChainId === "number"
      ? rawChainId
      : rawChainId.toLowerCase().startsWith("0x")
        ? Number.parseInt(rawChainId, 16)
        : Number(rawChainId);

  return Number.isFinite(chainId) && chainId > 0 ? chainId : null;
}

function getWalletConnectTransactionFrom(params: unknown): string | null {
  const tx = getFirstRequestParam(params);
  return getOptionalString(tx, "from") ?? null;
}

function assertTransactionFromMatchesWallet(params: unknown, snapshot: WalletSnapshot) {
  const from = getWalletConnectTransactionFrom(params);

  if (!from) {
    return;
  }

  if (from.toLowerCase() !== snapshot.address.toLowerCase()) {
    throw new Error("Transaction sender does not match the selected SIMPLE account.");
  }
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function getTransactionPreviewValue(params: unknown, key: string): string {
  const tx = getFirstRequestParam(params);
  return getOptionalString(tx, key) ?? "—";
}

function getApproveButtonLabel(method: string): string {
  switch (method) {
    case "wallet_switchEthereumChain":
      return "Approve network switch";

    case "eth_sendTransaction":
      return "Confirm transaction";

    case "eth_signTypedData_v4":
      return "Sign message";

    case "wallet_watchAsset":
      return "Add token";

    default:
      return "Approve";
  }
}

function canAutoRespondToMethod(method: string): boolean {
  return [
    "eth_requestAccounts",
    "eth_accounts",
    "eth_chainId",
    "net_version",
    "wallet_getCapabilities",
  ].includes(method);
}

function canApprovePendingRequest(method: string): boolean {
  return (
    method === "wallet_switchEthereumChain" ||
    method === "eth_sendTransaction" ||
    method === "eth_signTypedData_v4" ||
    method === "personal_sign" ||
    method === "wallet_watchAsset"
  );
}

function getPendingRequestActionLabel(method: string): string {
  switch (method) {
    case "wallet_switchEthereumChain":
      return "Approve network switch";

    case "personal_sign":
    case "eth_sign":
    case "eth_signTypedData":
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4":
      return "Signature confirmation required";

    case "eth_sendTransaction":
      return "Transaction confirmation required";

    default:
      return "Unsupported request";
  }
}

function formatRequestParams(params: unknown): string {
  try {
    const formatted = JSON.stringify(params ?? null, null, 2);
    return formatted.length > 2400 ? `${formatted.slice(0, 2400)}…` : formatted;
  } catch {
    return String(params ?? "");
  }
}

function getWalletWatchAssetPreviewForUi(params: unknown) {
  const direct = Array.isArray(params) ? params[0] : params;

  if (!direct || typeof direct !== "object") {
    return formatRequestParams(params);
  }

  const record = direct as Record<string, unknown>;
  const options = record.options;

  if (!options || typeof options !== "object") {
    return formatRequestParams(params);
  }

  const optionsRecord = options as Record<string, unknown>;

  return [
    `Type: ${typeof record.type === "string" ? record.type : "ERC20"}`,
    `Symbol: ${typeof optionsRecord.symbol === "string" ? optionsRecord.symbol : "—"}`,
    `Address: ${typeof optionsRecord.address === "string" ? optionsRecord.address : "—"}`,
    `Decimals: ${
      typeof optionsRecord.decimals === "number" || typeof optionsRecord.decimals === "string"
        ? String(optionsRecord.decimals)
        : "18"
    }`,
  ].join("\\n");
}


function parseWalletConnectChainIdForUi(chainNamespace?: string) {
  if (!chainNamespace?.startsWith("eip155:")) {
    return null;
  }

  const parsed = Number(chainNamespace.slice("eip155:".length));

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getWalletConnectChainDisplayNameForUi(chainNamespace?: string) {
  const chainId = parseWalletConnectChainIdForUi(chainNamespace);

  switch (chainId) {
    case 1:
      return "Ethereum";
    case 56:
      return "BNB Smart Chain";
    case 8453:
      return "Base";
    case 11155111:
      return "Sepolia";
    default:
      return chainId ? `Chain ${chainId}` : null;
  }
}


function simpleDecodeHexUtf8(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;

  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return value;
  }

  try {
    const bytes = new Uint8Array(
      hex.match(/.{2}/g)?.map((part) => parseInt(part, 16)) ?? [],
    );

    return new TextDecoder("utf-8")
      .decode(bytes)
      .replace(/\u0000/g, "")
      .trim();
  } catch {
    return value;
  }
}

function getSimplePersonalSignPreview(params: unknown) {
  const values = Array.isArray(params) ? params : [];

  const hexMessage = values.find(
    (value): value is string =>
      typeof value === "string" &&
      value.startsWith("0x") &&
      value.length > 42 &&
      !/^0x[a-fA-F0-9]{40}$/.test(value),
  );

  if (!hexMessage) {
    return formatRequestParams(params);
  }

  const decoded = simpleDecodeHexUtf8(hexMessage);

  return decoded || hexMessage;
}

function getSimpleWalletConnectPreview(method: string, params: unknown) {
  if (method === "personal_sign") {
    return getSimplePersonalSignPreview(params);
  }

  if (method === "eth_signTypedData_v4") {
    const values = Array.isArray(params) ? params : [];
    const candidate = values[1] ?? values[0] ?? params;

    if (typeof candidate === "string") {
      try {
        return JSON.stringify(JSON.parse(candidate), null, 2);
      } catch {
        return candidate;
      }
    }

    return formatRequestParams(candidate);
  }

  return formatRequestParams(params);
}


function decodeWcHexUtf8V2(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;

  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return value;
  }

  const bytes = hex.match(/.{1,2}/g)?.map((part) => parseInt(part, 16)) ?? [];

  if (bytes.length === 0 || bytes.some((byte) => Number.isNaN(byte))) {
    return value;
  }

  try {
    return new TextDecoder("utf-8", { fatal: false })
      .decode(new Uint8Array(bytes))
      .replace(/\u0000/g, "")
      .trim();
  } catch {
    return value;
  }
}

function flattenWcStringsV2(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenWcStringsV2(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      flattenWcStringsV2(item),
    );
  }

  return [];
}

function isWcAddressV2(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getWcPersonalSignPreviewV2(params: unknown) {
  const strings = flattenWcStringsV2(params);

  const hexMessage = strings.find(
    (value) =>
      value.startsWith("0x") &&
      value.length > 42 &&
      !isWcAddressV2(value),
  );

  if (hexMessage) {
    const decoded = decodeWcHexUtf8V2(hexMessage);

    if (decoded && decoded !== hexMessage) {
      return decoded;
    }

    return hexMessage;
  }

  const nonAddressText = strings.find((value) => !isWcAddressV2(value));

  return nonAddressText || formatRequestParams(params);
}

function getWcTypedDataPreviewV2(params: unknown) {
  const values = Array.isArray(params) ? params : [];
  const candidate = values[1] ?? values[0] ?? params;

  if (typeof candidate === "string") {
    try {
      return JSON.stringify(JSON.parse(candidate), null, 2);
    } catch {
      return candidate;
    }
  }

  return formatRequestParams(candidate);
}

function getWcPreviewTextV2(method: string, params: unknown) {
  if (method === "personal_sign") {
    return getWcPersonalSignPreviewV2(params);
  }

  if (method === "eth_signTypedData_v4") {
    return getWcTypedDataPreviewV2(params);
  }

  if (method === "eth_sendTransaction") {
    return [
      `From: ${getTransactionPreviewValue(params, "from")}`,
      `To: ${getTransactionPreviewValue(params, "to")}`,
      `Value: ${getTransactionPreviewValue(params, "value")}`,
      `Gas: ${getTransactionPreviewValue(params, "gas")}`,
      `Chain: ${getWalletConnectTransactionChainId(params) ?? "Selected network"}`,
    ].join("\\n");
  }

  return formatRequestParams(params);
}

type WalletConnectApprovalView = {
  title: string;
  description: string;
  status: string;
  previewTitle: string;
  previewText: string;
  primaryLabel: string;
  requiresPassword: boolean;
};

function getWalletConnectApprovalView(
  method: string,
  params: unknown,
): WalletConnectApprovalView {
  switch (method) {
    case "personal_sign":
      return {
        title: "Sign message",
        description: "A connected dApp is requesting a message signature from SIMPLE.",
        status: "Signature confirmation required",
        previewTitle: "Message preview",
        previewText: getWcPreviewTextV2(method, params),
        primaryLabel: "Sign",
        requiresPassword: true,
      };

    case "eth_signTypedData_v4":
      return {
        title: "Sign typed data",
        description: "A connected dApp is requesting a typed data signature from SIMPLE.",
        status: "Typed data signature required",
        previewTitle: "Typed data preview",
        previewText: getWcPreviewTextV2(method, params),
        primaryLabel: "Sign",
        requiresPassword: true,
      };

    case "eth_sendTransaction":
      return {
        title: "Confirm transaction",
        description: "A connected dApp is requesting a transaction from SIMPLE.",
        status: "Transaction confirmation required",
        previewTitle: "Transaction preview",
        previewText: getWcPreviewTextV2(method, params),
        primaryLabel: "Confirm transaction",
        requiresPassword: true,
      };

    case "wallet_watchAsset":
      return {
        title: "Add token",
        description: "A connected dApp is requesting to add a token to SIMPLE.",
        status: "Token add request",
        previewTitle: "Token preview",
        previewText: getWalletWatchAssetPreviewForUi(params),
        primaryLabel: "Add token",
        requiresPassword: false,
      };

    case "wallet_switchEthereumChain":
      return {
        title: "Switch network",
        description: "A connected dApp is requesting to switch the active network.",
        status: "Network switch request",
        previewTitle: "Network preview",
        previewText: formatRequestParams(params),
        primaryLabel: "Switch network",
        requiresPassword: false,
      };

    case "wallet_addEthereumChain":
      return {
        title: "Add network",
        description: "A connected dApp is requesting to add a new network.",
        status: "Network add request",
        previewTitle: "Network preview",
        previewText: formatRequestParams(params),
        primaryLabel: "Add network",
        requiresPassword: false,
      };

    case "wallet_getCapabilities":
      return {
        title: "Wallet capabilities",
        description: "A connected dApp is requesting wallet capability information.",
        status: "Capability request",
        previewTitle: "Request preview",
        previewText: formatRequestParams(params),
        primaryLabel: "Approve",
        requiresPassword: false,
      };

    default:
      return {
        title: "Confirm WalletConnect request",
        description: "A connected dApp is requesting an action from SIMPLE.",
        status: "Unsupported or unknown request",
        previewTitle: "Request preview",
        previewText: formatRequestParams(params),
        primaryLabel: "Approve",
        requiresPassword: false,
      };
  }
}



function isHexAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function decodeHexToReadableText(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;

  if (!hex || hex.length % 2 !== 0 || !/^[a-fA-F0-9]+$/.test(hex)) {
    return value;
  }

  try {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)?.map((chunk) => parseInt(chunk, 16)) ?? [],
    );

    const decoded = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes)
      .replace(/\u0000/g, "")
      .trim();

    return decoded || value;
  } catch {
    return value;
  }
}

function collectStringsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringsFromUnknown(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectStringsFromUnknown(item),
    );
  }

  return [];
}

function getReadablePersonalSignPreview(params: unknown) {
  const strings = collectStringsFromUnknown(params);

  const messageCandidate =
    strings.find(
      (value) =>
        value.startsWith("0x") &&
        value.length > 42 &&
        !isHexAddress(value),
    ) ??
    strings.find((value) => !isHexAddress(value)) ??
    "";

  if (!messageCandidate) {
    return formatRequestParams(params);
  }

  const readable = messageCandidate.startsWith("0x")
    ? decodeHexToReadableText(messageCandidate)
    : messageCandidate;

  return readable.trim() || formatRequestParams(params);
}

function getReadableTypedDataPreview(params: unknown) {
  const values = Array.isArray(params) ? params : [];
  const typedData = values[1] ?? values[0] ?? params;

  if (typeof typedData === "string") {
    try {
      return JSON.stringify(JSON.parse(typedData), null, 2);
    } catch {
      return typedData;
    }
  }

  return formatRequestParams(typedData);
}

function getWalletConnectApprovalPreview(method: string, params: unknown) {
  if (method === "personal_sign") {
    return getReadablePersonalSignPreview(params);
  }

  if (method === "eth_signTypedData_v4") {
    return getReadableTypedDataPreview(params);
  }

  if (method === "eth_sendTransaction") {
    return [
      `From: ${getTransactionPreviewValue(params, "from")}`,
      `To: ${getTransactionPreviewValue(params, "to")}`,
      `Value: ${getTransactionPreviewValue(params, "value")}`,
      `Gas: ${getTransactionPreviewValue(params, "gas")}`,
      `Chain: ${
        getWalletConnectTransactionChainId(params) ?? "Selected network"
      }`,
    ].join("\\n");
  }

  return formatRequestParams(params);
}


function decodeWalletConnectHexMessage(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;

  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return value;
  }

  try {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)?.map((part) => parseInt(part, 16)) ?? [],
    );

    const decoded = new TextDecoder()
      .decode(bytes)
      .replace(/\u0000/g, "")
      .trim();

    return decoded || value;
  } catch {
    return value;
  }
}

function getPersonalSignMessagePreview(params: unknown) {
  if (!Array.isArray(params)) {
    return formatRequestParams(params);
  }

  const messageCandidate = params.find(
    (value): value is string =>
      typeof value === "string" &&
      value.startsWith("0x") &&
      value.length > 10,
  );

  if (!messageCandidate) {
    return formatRequestParams(params);
  }

  return decodeWalletConnectHexMessage(messageCandidate);
}

function getTypedDataMessagePreview(params: unknown) {
  if (!Array.isArray(params)) {
    return formatRequestParams(params);
  }

  const typedDataCandidate = params[1] ?? params[0];

  if (typeof typedDataCandidate !== "string") {
    return formatRequestParams(typedDataCandidate ?? params);
  }

  try {
    return JSON.stringify(JSON.parse(typedDataCandidate), null, 2);
  } catch {
    return typedDataCandidate;
  }
}


function decodeHexUtf8Preview(value: string) {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;

  if (!normalized || normalized.length % 2 !== 0) {
    return value;
  }

  try {
    const bytes = normalized.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];

    if (bytes.some((byte) => Number.isNaN(byte))) {
      return value;
    }

    const decoded = new TextDecoder()
      .decode(new Uint8Array(bytes))
      .replace(/\u0000/g, "")
      .trim();

    return decoded || value;
  } catch {
    return value;
  }
}

function formatPersonalSignPreview(params: unknown) {
  const values = Array.isArray(params) ? params : [];

  const stringValues = values.filter(
    (value): value is string => typeof value === "string",
  );

  const hexMessage =
    stringValues.find((value) => value.startsWith("0x") && value.length > 10) ??
    stringValues[0];

  if (!hexMessage) {
    return formatRequestParams(params);
  }

  const decoded = hexMessage.startsWith("0x")
    ? decodeHexUtf8Preview(hexMessage)
    : hexMessage;

  return decoded;
}

function formatTypedDataPreview(params: unknown) {
  const values = Array.isArray(params) ? params : [];
  const typedData = values.length > 1 ? values[1] : values[0];

  if (typeof typedData === "string") {
    try {
      return JSON.stringify(JSON.parse(typedData), null, 2);
    } catch {
      return typedData;
    }
  }

  return formatRequestParams(typedData ?? params);
}


function extractSwitchChainId(params: unknown): number {
  const firstParam = Array.isArray(params) ? params[0] : params;
  const record = asRecord(firstParam);
  const rawChainId = record.chainId;

  if (typeof rawChainId !== "string" && typeof rawChainId !== "number") {
    throw new Error("Switch network request does not include chainId.");
  }

  const chainId =
    typeof rawChainId === "number"
      ? rawChainId
      : rawChainId.toLowerCase().startsWith("0x")
        ? Number.parseInt(rawChainId, 16)
        : Number(rawChainId);

  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error("Switch network request includes an invalid chainId.");
  }

  return chainId;
}

async function updateSelectedChainId(chainId: number) {
  const stored = await chromeStorageGet(["walletState"]);
  const walletState = asRecord(stored.walletState);

  const nextWalletState = {
    ...walletState,
    selectedChainId: chainId,
  };

  await chromeStorageSet({
    walletState: nextWalletState,
  });

  try {
    localStorage.setItem("walletState", JSON.stringify(nextWalletState));
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }
}

async function respondUnsupported(client: WalletKitClient, topic: string, id: number, message: string) {
  await client.respondSessionRequest?.({
    topic,
    response: {
      id,
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
      },
    },
  });
}

export default function WalletConnectPage({
  onBack,
  onConnected,
}: WalletConnectPageProps) {
  const clientRef = useRef<WalletKitClient | null>(null);
  const [uri, setUri] = useState("");
  const [proposal, setProposal] = useState<WalletConnectProposal | null>(null);
  const [walletSnapshot, setWalletSnapshot] = useState<WalletSnapshot | null>(null);
  const [status, setStatus] = useState("WalletConnect is ready.");
  const [error, setError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<WalletConnectPendingRequest | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [approvalPassword, setApprovalPassword] = useState("");

  const site = useMemo(() => {
    return proposal ? getProposalSite(proposal) : null;
  }, [proposal]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const surface = searchParams.get("surface");

    if (surface !== "approval") {
      return;
    }

    void readPendingWalletConnectRequest().then((request) => {
      if (!request) {
        return;
      }

      setPendingRequest(request);
      setError(null);
      setStatus(`WalletConnect request received: ${request.method}`);
    });
  }, []);

  async function getClient(): Promise<WalletKitClient> {
    if (clientRef.current) {
      return clientRef.current;
    }

    const client = await createWalletKitClient();
    clientRef.current = client;

    return client;
  }

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextUri = uri.trim();

    if (!nextUri.startsWith("wc:")) {
      setError("Paste a valid WalletConnect URI that starts with wc:.");
      return;
    }

    setIsPairing(true);
    setError(null);
    setStatus("Sending WalletConnect URI to SIMPLE engine…");

    try {
      const response = await sendWalletConnectEngineMessage<{
        ok?: boolean;
        error?: string;
      }>({
        type: "SIMPLE_WALLETCONNECT_PAIR",
        uri: nextUri,
      });

      if (!response?.ok) {
        throw new Error(response?.error ?? "WalletConnect pairing failed.");
      }

      setUri("");
      setStatus("WalletConnect pairing started. SIMPLE will approve the session automatically.");
      await onConnected?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "WalletConnect pairing failed.");
      setStatus("WalletConnect pairing failed.");
    } finally {
      setIsPairing(false);
    }
  }

  async function approveProposal() {
    if (!proposal) {
      return;
    }

    setIsApproving(true);
    setError(null);
    setStatus("Approving WalletConnect session…");

    try {
      const snapshot = walletSnapshot ?? (await readWalletSnapshot());
      const client = await getClient();
      const namespaces = await buildApprovedNamespaces(proposal, snapshot);

      await client.approveSession?.({
        id: proposal.id,
        namespaces,
      });

      const nextSite = getProposalSite(proposal);
      await saveConnectedSite(nextSite);

      setProposal(null);
      setUri("");
      setStatus("WalletConnect session approved.");
      await onConnected?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not approve WalletConnect session.");
      setStatus("WalletConnect approval failed.");
    } finally {
      setIsApproving(false);
    }
  }

  async function rejectProposal() {
    if (!proposal) {
      return;
    }

    setIsApproving(true);
    setError(null);
    setStatus("Rejecting WalletConnect session…");

    try {
      const client = await getClient();

      await rejectWalletConnectSession(client, proposal.id);

      setProposal(null);
      setStatus("WalletConnect session rejected.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not reject WalletConnect session.");
    } finally {
      setIsApproving(false);
    }
  }

  async function approvePendingRequest() {
    if (!pendingRequest) {
      return;
    }

    setIsResponding(true);
    setError(null);
    setStatus(`Approving ${pendingRequest.method}…`);

    try {
      const needsPassword = ["eth_sendTransaction", "eth_signTypedData_v4", "personal_sign"].includes(
        pendingRequest.method,
      );

      const password = approvalPassword.trim();

      if (needsPassword && !password) {
        throw new Error("Wallet password is required.");
      }

      const response = await sendWalletConnectEngineMessage<{
        ok?: boolean;
        error?: string;
        result?: unknown;
      }>({
        type: "SIMPLE_WALLETCONNECT_APPROVE_REQUEST",
        requestId: pendingRequest.id,
        password,
      });

      if (!response?.ok) {
        throw new Error(response?.error ?? "WalletConnect request approval failed.");
      }

      setPendingRequest(null);
      setApprovalPassword("");
      await clearPendingWalletConnectRequest();

      if (pendingRequest.method === "eth_sendTransaction") {
        setStatus("Transaction submitted.");
      } else if (pendingRequest.method === "eth_signTypedData_v4") {
        setStatus("Message signed.");
      } else {
        setStatus("WalletConnect request approved.");
      }

      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("surface") === "approval") {
        window.setTimeout(() => window.close(), 700);
      }
    } catch (nextError) {
      console.error("WalletConnect request approval failed:", nextError);

      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not approve WalletConnect request.",
      );
      setStatus("WalletConnect request approval failed.");
    } finally {
      setIsResponding(false);
    }
  }

  async function rejectPendingRequest() {
    if (!pendingRequest) {
      return;
    }

    setIsResponding(true);
    setError(null);
    setStatus("Rejecting WalletConnect request…");

    try {
      const response = await sendWalletConnectEngineMessage<{
        ok?: boolean;
        error?: string;
      }>({
        type: "SIMPLE_WALLETCONNECT_REJECT_REQUEST",
        requestId: pendingRequest.id,
      });

      if (!response?.ok) {
        throw new Error(response?.error ?? "WalletConnect request rejection failed.");
      }

      setPendingRequest(null);
      setApprovalPassword("");
      await clearPendingWalletConnectRequest();
      setStatus("WalletConnect request rejected.");

      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("surface") === "approval") {
        window.setTimeout(() => window.close(), 300);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not reject WalletConnect request.",
      );
      setStatus("WalletConnect request rejection failed.");
    } finally {
      setIsResponding(false);
    }
  }

  useEffect(() => {
    // WalletConnect runtime is owned by the offscreen engine.
    // This page is only a UI bridge: pair URI, show pending approval,
    // and send Confirm / Reject messages to the engine.
    void sendWalletConnectEngineMessage({
      type: "SIMPLE_WALLETCONNECT_ENGINE_PING",
    }).catch((nextError) => {
      console.warn("WalletConnect engine ping failed:", nextError);
    });
  }, []);

  if (pendingRequest) {
    const method = pendingRequest.method;
    const requestedWalletConnectChainName =
      getWalletConnectChainDisplayNameForUi(
        (pendingRequest as { chainId?: string }).chainId,
      );
    const shouldShowNetworkSwitchNotice =
      method === "eth_sendTransaction" && Boolean(requestedWalletConnectChainName);

    const requiresPassword =
      method === "eth_sendTransaction" ||
      method === "eth_signTypedData_v4" ||
      method === "personal_sign";

    const canApprove =
      !isResponding &&
      (!requiresPassword || approvalPassword.trim().length > 0);

    const requestTitle =
      method === "personal_sign" || method === "eth_signTypedData_v4"
        ? "Sign message"
        : method === "wallet_watchAsset"
          ? "Add token"
          : method === "eth_sendTransaction"
            ? "Confirm transaction"
            : "Confirm request";

    const approveLabel =
      method === "personal_sign" || method === "eth_signTypedData_v4"
        ? "Sign"
        : method === "wallet_watchAsset"
          ? "Add token"
          : method === "eth_sendTransaction"
            ? "Confirm"
            : "Approve";

    const statusLabel =
      method === "personal_sign" || method === "eth_signTypedData_v4"
        ? "Signature confirmation required"
        : method === "wallet_watchAsset"
          ? "Token approval required"
          : method === "eth_sendTransaction"
            ? "Transaction confirmation required"
            : "Approval required";

    const previewTitle =
      method === "personal_sign" || method === "eth_signTypedData_v4"
        ? "Message preview"
        : method === "eth_sendTransaction"
          ? "Transaction preview"
          : "Request preview";

    const approvalView = getWalletConnectApprovalView(
      method,
      pendingRequest.params,
    );

    const previewText = approvalView.previewText;
    const txPreviewText =
      method === "eth_sendTransaction" && requestedWalletConnectChainName
        ? previewText.replace(
            "Chain: Selected network",
            `Chain: ${requestedWalletConnectChainName}`,
          )
        : previewText;

    return (
      <main
        style={{
          position: "fixed",
          inset: 0,
          height: "100dvh",
          minHeight: "100dvh",
          width: "100vw",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#f7f7f4",
          color: "#111111",
          boxSizing: "border-box",
        }}
      >
        <header
          style={{
            height: 56,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 14px",
            borderBottom: "1px solid #e7e5df",
            background: "#f7f7f4",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            style={{
              width: 34,
              height: 34,
              border: "none",
              borderRadius: 12,
              background: "transparent",
              color: "#111111",
              cursor: "pointer",
              fontSize: 28,
              lineHeight: "30px",
              padding: 0,
            }}
          >
            ‹
          </button>

          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            Confirm request
          </div>
        </header>

        <section
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "14px 14px 164px",
            width: "100%",
            display: "grid",
            gap: 14,
            alignContent: "start",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 15,
                background: "#111111",
                color: "#ffffff",
                display: "grid",
                placeItems: "center",
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              WC
            </div>

            <div style={{ display: "grid", gap: 7 }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 24,
                  lineHeight: "27px",
                  letterSpacing: "-0.055em",
                  fontWeight: 880,
                }}
              >
                {requestTitle}
              </h1>

              <p
                style={{
                  margin: 0,
                  color: "#6f6f68",
                  fontSize: 13,
                  lineHeight: "19px",
                }}
              >
                {approvalView.description}
              </p>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #dfddd6",
              borderRadius: 16,
              background: "#ffffff",
              padding: 12,
              width: "100%",
              display: "grid",
              gap: 14,
              overflow: "visible",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 8,
                fontSize: 13,
                lineHeight: "19px",
              }}
            >
              <div>
                <strong>Method:</strong> {method}
              </div>
              <div>
                <strong>Status:</strong> {approvalView.status}
              </div>
            </div>

            <div
              style={{
                border: "1px solid #e5e3dc",
                borderRadius: 15,
                background: "#fbfbf8",
                padding: 14,
                display: "grid",
                gap: 10,
                overflow: "hidden",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 850,
                  letterSpacing: "-0.01em",
                }}
              >
                {approvalView.previewTitle}
              </div>

              <pre
                style={{
                  margin: 0,
                  maxHeight: 128,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  fontFamily:
                    'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  color: "#5e5e57",
                  fontSize: 12,
                  lineHeight: "18px",
                }}
              >
                {String(txPreviewText).trim() ||
                  "No readable preview available. Expand Raw request data below."}
              </pre>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  color: "#111111",
                  fontSize: 13,
                  fontWeight: 850,
                }}
              >
                Raw request data
              </div>

              <div
                style={{
                  overflow: "hidden",
                  border: "1px solid #d9d5cd",
                  borderRadius: 16,
                  background: "#ffffff",
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    minHeight: 36,
                    padding: "0 10px 0 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderBottom: "1px solid #e7e3db",
                    background: "#f6f5f1",
                    color: "#5f5c55",
                    fontSize: 12,
                    fontWeight: 850,
                    boxSizing: "border-box",
                  }}
                >
                  <span>Request body</span>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();

                      void navigator.clipboard?.writeText(
                        formatRequestParams(pendingRequest.params),
                      );
                    }}
                    style={{
                      height: 26,
                      minWidth: 58,
                      padding: "0 10px",
                      border: "1px solid #d6d2c9",
                      borderRadius: 999,
                      background: "#ffffff",
                      color: "#111111",
                      fontSize: 12,
                      fontWeight: 850,
                      cursor: "pointer",
                    }}
                  >
                    Copy
                  </button>
                </div>

                <div
                  style={{
                    height: 112,
                    maxHeight: 112,
                    overflowY: "auto",
                    overflowX: "hidden",
                    padding: 12,
                    background: "#fbfaf7",
                    boxSizing: "border-box",
                    scrollbarWidth: "thin",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      color: "#37342f",
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      fontSize: 11,
                      lineHeight: "17px",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {formatRequestParams(pendingRequest.params)}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {requiresPassword ? (
            <label
              style={{
                display: "grid",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 850,
                  color: "#3a3a36",
                }}
              >
                Wallet password
              </span>

              <input
                type="password"
                value={approvalPassword}
                onChange={(event) => setApprovalPassword(event.target.value)}
                placeholder="Enter wallet password"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canApprove) {
                    event.preventDefault();
                    void approvePendingRequest();
                  }
                }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  height: 46,
                  borderRadius: 13,
                  border: "1px solid #dad7cf",
                  background: "#ffffff",
                  padding: "0 14px",
                  fontSize: 15,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />

              <span
                style={{
                  color: "#8a8982",
                  fontSize: 12,
                  lineHeight: "16px",
                }}
              >
                Sign becomes available after entering your wallet password.
              </span>
            </label>
          ) : null}

          {shouldShowNetworkSwitchNotice ? (
            <div
              style={{
                borderRadius: 14,
                background: "#fff8df",
                color: "#6c4b00",
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: "17px",
                fontWeight: 750,
                border: "1px solid #f2df9b",
              }}
            >
              SIMPLE will switch to {requestedWalletConnectChainName} before
              sending this transaction.
            </div>
          ) : null}

          <div
            style={{
              borderRadius: 14,
              background: "#efeee9",
              color: "#77766f",
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: "17px",
            }}
          >
            Request received: {method}
          </div>
        </section>

        <footer
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            borderTop: "1px solid #e7e5df",
            background: "#f7f7f4",
            padding: "10px 14px 14px",
            width: "100%",
            display: "grid",
            gap: 10,
            boxSizing: "border-box",
            boxShadow: "0 -16px 28px rgba(247, 247, 244, 0.96)",
          }}
        >
          <button
            type="button"
            className="btn primary lg full"
            onClick={() => void approvePendingRequest()}
            disabled={!canApprove}
            style={{
              width: "100%",
              height: 46,
              borderRadius: 13,
              border: "none",
              background: canApprove ? "#111111" : "#b9b9b2",
              color: "#ffffff",
              fontSize: 16,
              fontWeight: 850,
              cursor: canApprove ? "pointer" : "default",
            }}
          >
            {isResponding ? "Processing..." : approveLabel}
          </button>

          <button
            type="button"
            className="btn secondary lg full"
            onClick={() => void rejectPendingRequest()}
            disabled={isResponding}
            style={{
              width: "100%",
              height: 46,
              borderRadius: 13,
              border: "1px solid #d6d3cb",
              background: "#ffffff",
              color: "#111111",
              fontSize: 16,
              fontWeight: 750,
              cursor: isResponding ? "default" : "pointer",
            }}
          >
            Reject
          </button>
        </footer>
      </main>
    );
  }

  return (
    <main
      style={{
        height: "100vh",
        minHeight: "100vh",
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--bg, #ffffff)",
        color: "var(--text-primary, #111111)",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          height: 56,
          borderBottom: "1px solid var(--border, #e8e8e8)",
          background: "var(--bg, #ffffff)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 680,
            height: "100%",
            margin: "0 auto",
            padding: "0 12px",
            boxSizing: "border-box",
            display: "grid",
            gridTemplateColumns: "44px 1fr 44px",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            style={{
              width: 36,
              height: 36,
              border: 0,
              background: "transparent",
              color: "var(--text-primary, #111111)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <BackIcon />
          </button>

          <div
            style={{
              fontSize: 15,
              lineHeight: "20px",
              fontWeight: 800,
            }}
          >
            WalletConnect
          </div>

          <div />
        </div>
      </header>

      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
          padding: "52px 12px 88px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            margin: 0,
            maxWidth: 520,
            fontSize: 46,
            lineHeight: "50px",
            letterSpacing: "-0.055em",
            fontWeight: 900,
          }}
        >
          WalletConnect
        </h1>

        <p
          style={{
            margin: "14px 0 0",
            maxWidth: 560,
            color: "var(--text-secondary, #777777)",
            fontSize: 14,
            lineHeight: "21px",
          }}
        >
          Paste a WalletConnect URI from a dApp to connect it with SIMPLE.
        </p>

        <form onSubmit={pair} style={{ marginTop: 34, display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span
              style={{
                color: "var(--text-primary, #111111)",
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              WalletConnect URI
            </span>

            <textarea
              value={uri}
              placeholder="wc:..."
              onChange={(event) => setUri(event.target.value)}
              style={{
                width: "100%",
                minHeight: 96,
                border: "1px solid var(--border, #dedede)",
                borderRadius: 14,
                background: "var(--bg, #ffffff)",
                color: "var(--text-primary, #111111)",
                padding: "12px 14px",
                boxSizing: "border-box",
                font: "inherit",
                fontSize: 13,
                lineHeight: "19px",
                resize: "vertical",
              }}
            />
          </label>

          <button
            type="submit"
            className="btn primary lg full"
            disabled={isPairing || isApproving}
          >
            {isPairing ? "Connecting…" : "Connect"}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 16,
            background: "#f7f7f4",
            color: "var(--text-secondary, #777777)",
            fontSize: 13,
            lineHeight: "19px",
          }}
        >
          {status}
        </div>

        {error ? (
          <div
            style={{
              marginTop: 14,
              color: "#a23b2d",
              fontSize: 13,
              lineHeight: "19px",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}


        {site && proposal ? (
          <section
            style={{
              marginTop: 28,
              border: "1px solid var(--border, #dedede)",
              borderRadius: 24,
              padding: 18,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 999,
                background: "var(--text-primary, #111111)",
                color: "#ffffff",
                display: "grid",
                placeItems: "center",
              }}
            >
              <LinkIcon />
            </div>

            <div
              style={{
                marginTop: 16,
                fontSize: 18,
                lineHeight: "24px",
                fontWeight: 850,
                letterSpacing: "-0.02em",
              }}
            >
              Connect {site.name ?? site.origin}?
            </div>

            <p
              style={{
                margin: "6px 0 0",
                color: "var(--text-secondary, #777777)",
                fontSize: 13,
                lineHeight: "19px",
              }}
            >
              This site will be able to request your wallet address and network.
              Signing and transactions are not enabled in this MVP.
            </p>

            <div
              style={{
                marginTop: 16,
                display: "grid",
                gap: 8,
                color: "var(--text-secondary, #777777)",
                fontSize: 12,
                lineHeight: "17px",
              }}
            >
              <div>Origin: {site.origin}</div>
              <div>
                Required methods:{" "}
                {getNamespace(proposal, "eip155").methods?.join(", ") || "None"}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="btn primary lg full"
                disabled={isApproving}
                onClick={() => void approveProposal()}
              >
                {isApproving ? "Approving…" : "Approve connection"}
              </button>

              <button
                type="button"
                className="btn secondary lg full"
                disabled={isApproving}
                onClick={() => void rejectProposal()}
              >
                Reject
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
