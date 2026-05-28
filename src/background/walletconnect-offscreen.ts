/// <reference types="chrome" />

import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";

const PENDING_WALLETCONNECT_REQUEST_KEY = "pendingWalletConnectRequest";
const CONNECTED_SITES_KEY = "connectedSites";
const WATCHED_ASSETS_KEY = "watchedAssets";

const DEFAULT_EIP155_CHAINS = ["eip155:1", "eip155:56", "eip155:8453", "eip155:11155111"];

const DEFAULT_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "wallet_getCapabilities",
  "wallet_sendCalls",
  "wallet_getCallsStatus",
  "wallet_showCallsStatus",
];

const DEFAULT_EVENTS = ["accountsChanged", "chainChanged"];

type WalletConnectPendingRequest = {
  topic: string;
  id: number;
  method: string;
  params: unknown;
  chainId?: string;
  receivedAt: string;
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

function getRequestedNamespaceValues(
  proposal: any,
  key: "chains" | "methods" | "events",
): string[] {
  const required = proposal?.requiredNamespaces?.eip155?.[key];
  const optional = proposal?.optionalNamespaces?.eip155?.[key];

  return uniqueStrings([
    ...(Array.isArray(required) ? required : []),
    ...(Array.isArray(optional) ? optional : []),
  ]);
}

function getRequestedEip155Chains(proposal: any): string[] {
  const chains = getRequestedNamespaceValues(proposal, "chains").filter((chain) =>
    chain.startsWith("eip155:"),
  );

  return chains.length > 0 ? chains : DEFAULT_EIP155_CHAINS;
}

function getRequestedMethods(proposal: any): string[] {
  return uniqueStrings([
    ...DEFAULT_METHODS,
    ...getRequestedNamespaceValues(proposal, "methods"),
  ]);
}

function getRequestedEvents(proposal: any): string[] {
  return uniqueStrings([
    ...DEFAULT_EVENTS,
    ...getRequestedNamespaceValues(proposal, "events"),
  ]);
}

async function buildNamespacesForProposal(proposal: any) {
  const selected = await getSelectedWalletAccount();
  const chains = getRequestedEip155Chains(proposal);
  const methods = getRequestedMethods(proposal);
  const events = getRequestedEvents(proposal);
  const accounts = chains.map((chain) => `${chain}:${selected.address}`);

  const namespaces = {
    eip155: {
      chains,
      methods,
      events,
      accounts,
    },
  };

  const debugPayload = {
    requiredNamespaces: proposal?.requiredNamespaces,
    optionalNamespaces: proposal?.optionalNamespaces,
    approvedNamespaces: namespaces,
  };

  console.log("SIMPLE WalletConnect proposal namespaces:", debugPayload);

  await chromeStorageSet({
    lastWalletConnectProposalDebug: {
      ...debugPayload,
      createdAt: new Date().toISOString(),
    },
  });

  return namespaces;
}

async function pairWalletKit(uri: string) {
  const walletKit = await getWalletKit();

  await chromeStorageSet({
    lastWalletConnectPairDebug: {
      stage: "before_pair",
      uriPrefix: uri.slice(0, 32),
      createdAt: new Date().toISOString(),
    },
  });

  const pair = (walletKit as any).core?.pairing?.pair;

  if (typeof pair === "function") {
    await pair.call((walletKit as any).core?.pairing, { uri });

    await chromeStorageSet({
      lastWalletConnectPairDebug: {
        stage: "after_core_pair",
        uriPrefix: uri.slice(0, 32),
        createdAt: new Date().toISOString(),
      },
    });

    return;
  }

  if (typeof (walletKit as any).pair === "function") {
    await (walletKit as any).pair({ uri });

    await chromeStorageSet({
      lastWalletConnectPairDebug: {
        stage: "after_walletkit_pair",
        uriPrefix: uri.slice(0, 32),
        createdAt: new Date().toISOString(),
      },
    });

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
    const asset = parseWalletWatchAssetRequest(
      pendingRequest.params,
      pendingRequest.chainId,
    );

    await saveWatchedAsset(asset);

    await (walletKit as any).respondSessionRequest?.({
      topic: pendingRequest.topic,
      response: {
        id: pendingRequest.id,
        jsonrpc: "2.0",
        result: true,
      },
    });

    await clearPendingWalletConnectRequest();

    return {
      result: true,
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

  walletKit.on("session_proposal", async (event: any) => {
    await chromeStorageSet({
      lastWalletConnectProposalRaw: {
        id: event?.id,
        params: event?.params,
        createdAt: new Date().toISOString(),
      },
    });

    try {
      const proposal = event.params;
      const namespaces = await buildNamespacesForProposal(proposal);

      await (walletKit as any).approveSession?.({
        id: event.id,
        namespaces,
      });

      await saveConnectedSiteFromProposal(proposal);

      console.log("SIMPLE WalletConnect session approved by offscreen engine.");
    } catch (error) {
      console.error("WalletConnect session proposal approval failed:", {
        error,
        proposal: event?.params,
      });

      await chromeStorageSet({
        lastWalletConnectProposalError: {
          message: error instanceof Error ? error.message : String(error),
          proposal: event?.params,
          createdAt: new Date().toISOString(),
        },
      });

      try {
        await (walletKit as any).rejectSession?.({
          id: event.id,
          reason: {
            code: 5000,
            message: error instanceof Error ? error.message : "Session approval failed.",
          },
        });
      } catch (rejectError) {
        console.error("WalletConnect session rejection failed:", rejectError);
      }
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

      await chromeStorageSet({
        lastWalletConnectAutoResponse: {
          method,
          result: buildEmptyWalletCapabilities(params),
          createdAt: new Date().toISOString(),
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
