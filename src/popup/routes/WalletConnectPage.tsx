import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

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
  return method === "wallet_switchEthereumChain";
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
      return "Signature approval is coming next";

    case "eth_sendTransaction":
      return "Transaction approval is coming next";

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

  const site = useMemo(() => {
    return proposal ? getProposalSite(proposal) : null;
  }, [proposal]);

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
    setStatus("Waiting for session proposal…");

    try {
      const snapshot = await readWalletSnapshot();
      const client = await getClient();

      setWalletSnapshot(snapshot);

      await pairWalletKit(client, nextUri);

      setStatus("Pairing started. Approve the session proposal when it appears.");
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
      const client = await getClient();

      if (pendingRequest.method === "wallet_switchEthereumChain") {
        const chainId = extractSwitchChainId(pendingRequest.params);

        await updateSelectedChainId(chainId);

        await client.respondSessionRequest?.({
          topic: pendingRequest.topic,
          response: {
            id: pendingRequest.id,
            jsonrpc: "2.0",
            result: null,
          },
        });

        setWalletSnapshot(await readWalletSnapshot());
        setPendingRequest(null);
        setStatus(`Network switched to chain ${chainId}.`);
        return;
      }

      await respondUnsupported(
        client,
        pendingRequest.topic,
        pendingRequest.id,
        `${pendingRequest.method} approval is not supported yet.`,
      );

      setPendingRequest(null);
      setStatus(`${pendingRequest.method} was rejected because it is not supported yet.`);
    } catch (nextError) {
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
    setStatus(`Rejecting ${pendingRequest.method}…`);

    try {
      const client = await getClient();

      await client.respondSessionRequest?.({
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

      setPendingRequest(null);
      setStatus("WalletConnect request rejected.");
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
    let active = true;

    void getClient()
      .then((client) => {
        if (!active) {
          return;
        }

        const handleProposal = (event: WalletConnectProposal) => {
          setProposal(event);
          setError(null);
          setStatus("Session proposal received.");
        };

        const handleRequest = async (event: any) => {
          const topic = String(event.topic ?? "");
          const id = Number(event.id ?? event.params?.request?.id);
          const request = event.params?.request ?? event.request ?? {};
          const method = String(request.method ?? "");
          const params = request.params ?? [];

          if (!topic || !Number.isFinite(id) || !method) {
            return;
          }

          if (canAutoRespondToMethod(method)) {
            try {
              const snapshot = await readWalletSnapshot();
              const result = getJsonRpcResult(method, snapshot);

              await client.respondSessionRequest?.({
                topic,
                response: {
                  id,
                  jsonrpc: "2.0",
                  result,
                },
              });

              return;
            } catch (requestError) {
              await respondUnsupported(
                client,
                topic,
                id,
                requestError instanceof Error
                  ? requestError.message
                  : "WalletConnect request is not supported yet.",
              );

              return;
            }
          }

          setPendingRequest({
            topic,
            id,
            method,
            params,
          });
          setError(null);
          setStatus(`WalletConnect request received: ${method}`);
        };

        client.on?.("session_proposal", handleProposal);
        client.on?.("session_request", handleRequest);

        return () => {
          client.off?.("session_proposal", handleProposal);
          client.off?.("session_request", handleRequest);
        };
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "WalletConnect initialization failed.");
        setStatus("WalletConnect initialization failed.");
      });

    return () => {
      active = false;
    };
  }, []);

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

        {pendingRequest ? (
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
                width: 44,
                height: 44,
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
              WalletConnect request
            </div>

            <p
              style={{
                margin: "6px 0 0",
                color: "var(--text-secondary, #777777)",
                fontSize: 13,
                lineHeight: "19px",
              }}
            >
              A connected dApp is requesting an action from SIMPLE.
            </p>

            <div
              style={{
                marginTop: 16,
                display: "grid",
                gap: 10,
                fontSize: 13,
                lineHeight: "19px",
              }}
            >
              <div>
                <strong>Method:</strong> {pendingRequest.method}
              </div>

              <div>
                <strong>Status:</strong> {getPendingRequestActionLabel(pendingRequest.method)}
              </div>

              <pre
                style={{
                  margin: 0,
                  maxHeight: 220,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  border: "1px solid var(--border, #dedede)",
                  borderRadius: 14,
                  padding: 12,
                  background: "#f7f7f4",
                  color: "var(--text-secondary, #777777)",
                  fontSize: 12,
                  lineHeight: "17px",
                }}
              >
                {formatRequestParams(pendingRequest.params)}
              </pre>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
              {canApprovePendingRequest(pendingRequest.method) ? (
                <button
                  type="button"
                  className="btn primary lg full"
                  disabled={isResponding}
                  onClick={() => void approvePendingRequest()}
                >
                  {isResponding ? "Approving…" : "Approve"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary lg full"
                  disabled
                  title="This request type needs a dedicated approval screen."
                >
                  Approval coming next
                </button>
              )}

              <button
                type="button"
                className="btn secondary lg full"
                disabled={isResponding}
                onClick={() => void rejectPendingRequest()}
              >
                {isResponding ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </section>
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
                width: 44,
                height: 44,
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
