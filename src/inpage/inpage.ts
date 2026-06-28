// src/inpage/inpage.ts
// Runs in the page's MAIN world (declared via manifest content_scripts world: "MAIN").
// ZERO runtime imports — must compile to a flat classic script with no import/export.
// Wrapped in IIFE to avoid polluting the page's global scope.

(function () {
  "use strict";

  // Guard: don't inject twice (e.g. in multi-frame pages).
  if ((window as unknown as Record<string, unknown>)["__simplInjected"]) return;
  (window as unknown as Record<string, unknown>)["__simplInjected"] = true;

  const SIMPL_REQ = "SIMPL_PROVIDER_REQUEST";
  const SIMPL_RES = "SIMPL_PROVIDER_RESPONSE";
  const SIMPL_EVT = "SIMPL_PROVIDER_EVENT";

  type RpcError = { code: number; message: string };
  type EthHandler = (...args: unknown[]) => void;
  type RequestArgs = { method: string; params?: readonly unknown[] | unknown[] };

  interface SimplProvider {
    isMetaMask: boolean;
    isSimpl: boolean;
    request(args: RequestArgs): Promise<unknown>;
    on(event: string, handler: EthHandler): SimplProvider;
    removeListener(event: string, handler: EthHandler): SimplProvider;
    off(event: string, handler: EthHandler): SimplProvider;
    sendAsync(
      payload: { id?: number; method: string; params?: unknown[] },
      cb: (err: Error | null, res: unknown) => void,
    ): void;
  }

  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  const listeners = new Map<string, Set<EthHandler>>();

  let idCounter = 0;
  function nextId(): string {
    idCounter += 1;
    return `simpl-${Date.now().toString(36)}-${idCounter.toString(36)}`;
  }

  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object") return;

    if (d["type"] === SIMPL_RES) {
      const id = d["id"] as string;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);

      if (d["error"]) {
        const e = d["error"] as Partial<RpcError>;
        const err = new Error(e.message ?? "Request failed");
        (err as unknown as Record<string, unknown>)["code"] = e.code ?? -32603;
        entry.reject(err);
      } else {
        entry.resolve(d["result"]);
      }
      return;
    }

    if (d["type"] === SIMPL_EVT) {
      const eventName = d["event"] as string;
      const eventData = d["data"];

      // TRON-namespace events drive the TronLink-compatible provider. The
      // background only signals that the connection/account changed; we
      // re-hydrate window.tronWeb, which emits to the dApp's TRON listeners.
      if (d["namespace"] === "tron") {
        if (eventName === "disconnect") {
          setTronAccount(null, null);
        } else {
          hydrateTron();
        }
        return;
      }

      listeners.get(eventName)?.forEach((h) => {
        try {
          h(eventData);
        } catch {
          // Swallow handler errors to keep other handlers running.
        }
      });
    }
  });

  function sendRpcRequest(method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      window.postMessage({ type: SIMPL_REQ, id, method, params }, "*");
    });
  }

  const provider: SimplProvider = {
    isMetaMask: false,
    isSimpl: true,

    request(args: RequestArgs): Promise<unknown> {
      const { method, params = [] } = args;
      return sendRpcRequest(method, Array.from(params));
    },

    on(event: string, handler: EthHandler): SimplProvider {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return provider;
    },

    removeListener(event: string, handler: EthHandler): SimplProvider {
      listeners.get(event)?.delete(handler);
      return provider;
    },

    off(event: string, handler: EthHandler): SimplProvider {
      return provider.removeListener(event, handler);
    },

    sendAsync(
      payload: { id?: number; method: string; params?: unknown[] },
      cb: (err: Error | null, res: unknown) => void,
    ): void {
      provider
        .request({ method: payload.method, params: payload.params })
        .then((result: unknown) => {
          cb(null, { jsonrpc: "2.0", id: payload.id, result });
        })
        .catch((err: unknown) => {
          cb(err instanceof Error ? err : new Error(String(err)), null);
        });
    },
  };

  // Always expose SIMPL on a dedicated namespace.
  // Set window.ethereum only if no other wallet has claimed it.
  const win = window as unknown as Record<string, unknown>;
  win["simplEthereum"] = provider;
  // Dedicated, unambiguous namespace that first-party surfaces (e.g. the SIMPL
  // dashboard) detect without competing with other wallets on window.ethereum.
  win["simpl"] = provider;

  if (!win["ethereum"]) {
    win["ethereum"] = provider;
  }

  // ─────────────────── TRON provider (TronLink-compatible) ────────────────────
  // Exposes window.tron, window.tronLink and window.tronWeb so TRON dApps
  // (e.g. tronscan.org) detect SIMPL as a TRON wallet. All requests are tagged
  // namespace "tron" so they route to the TRON handler in the background and
  // never collide with the EVM provider. Accounts are ALWAYS TRON base58 (T…) —
  // never EVM 0x addresses. No key material ever lives in this script.
  const TRON_CHAIN_ID = "0x2b6653dc";
  const TRON_HOST = "https://api.trongrid.io";

  const tronListeners = new Map<string, Set<EthHandler>>();

  function emitTron(event: string, data: unknown): void {
    tronListeners.get(event)?.forEach((h) => {
      try {
        h(data);
      } catch {
        // Keep other handlers running.
      }
    });
  }

  function sendTronRpc(method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      window.postMessage(
        { type: SIMPL_REQ, id, method, params, namespace: "tron" },
        "*",
      );
    });
  }

  // Minimal window.tronWeb shim — just enough for dApp detection + signing.
  // trx.sign forwards to the wallet signing layer and returns the SIGNED tx;
  // it never broadcasts (the dApp decides) and never touches a private key.
  const tronWeb = {
    ready: false,
    fullNode: { host: TRON_HOST },
    solidityNode: { host: TRON_HOST },
    eventServer: { host: TRON_HOST },
    defaultAddress: {
      base58: false as string | false,
      hex: false as string | false,
      name: false as string | false,
      type: 0,
    },
    trx: {
      sign(transaction: unknown): Promise<unknown> {
        return sendTronRpc("tron_signTransaction", [transaction]);
      },
    },
  };

  const tron = {
    isSimpl: true,
    isTronLink: true,
    ready: false,
    chainId: TRON_CHAIN_ID,
    selectedAddress: null as string | null,
    tronWeb,

    request(args: RequestArgs): Promise<unknown> {
      const { method, params = [] } = args;
      const result = sendTronRpc(method, Array.from(params));
      // Refresh window.tronWeb after any account-returning call.
      if (/requestAccounts|tron_accounts/i.test(method)) {
        result.then(() => hydrateTron()).catch(() => {});
      }
      return result;
    },

    on(event: string, handler: EthHandler) {
      if (!tronListeners.has(event)) tronListeners.set(event, new Set());
      tronListeners.get(event)!.add(handler);
      return tron;
    },

    removeListener(event: string, handler: EthHandler) {
      tronListeners.get(event)?.delete(handler);
      return tron;
    },

    off(event: string, handler: EthHandler) {
      return tron.removeListener(event, handler);
    },
  };

  // Apply (or clear) the connected TRON account and emit lifecycle events to the
  // dApp's listeners on transition.
  function setTronAccount(base58: string | null, hex: string | null): void {
    const wasConnected = tron.selectedAddress !== null;
    const prevAddress = tron.selectedAddress;

    if (base58) {
      tron.ready = true;
      tron.selectedAddress = base58;
      tronWeb.ready = true;
      tronWeb.defaultAddress.base58 = base58;
      tronWeb.defaultAddress.hex = hex || false;
    } else {
      tron.ready = false;
      tron.selectedAddress = null;
      tronWeb.ready = false;
      tronWeb.defaultAddress.base58 = false;
      tronWeb.defaultAddress.hex = false;
    }

    if (!wasConnected && tron.selectedAddress) {
      emitTron("connect", { chainId: TRON_CHAIN_ID });
    }
    if (prevAddress !== tron.selectedAddress) {
      emitTron("accountsChanged", tron.selectedAddress ? [tron.selectedAddress] : []);
    }
    if (wasConnected && !tron.selectedAddress) {
      emitTron("disconnect", {});
    }
  }

  // Pull the current TRON account from the background (silent — no popup). When
  // connected, populates window.tronWeb so the dApp can detect the wallet.
  function hydrateTron(): void {
    sendTronRpc("tron_getAccount", [])
      .then((res) => {
        const r = res as { base58?: string; hex?: string } | null;
        if (r && typeof r.base58 === "string") {
          setTronAccount(r.base58, typeof r.hex === "string" ? r.hex : null);
        }
        tronDebugLog("hydrated");
      })
      .catch(() => {
        // Not connected or wallet locked — leave window.tronWeb un-hydrated.
      });
  }

  // Dev-only diagnostics. Opt in by running `localStorage.SIMPL_TRON_DEBUG = "1"`
  // on the page, then reload. NEVER logs private keys, mnemonic, signed tx, or
  // decrypted wallet — only provider presence + the PUBLIC address and chain id.
  function tronDebugEnabled(): boolean {
    try {
      return window.localStorage.getItem("SIMPL_TRON_DEBUG") === "1";
    } catch {
      return false;
    }
  }

  function tronDebugLog(stage: string): void {
    if (!tronDebugEnabled()) return;
    try {
      console.log("[SIMPL TRON]", stage, {
        tron: typeof win["tron"] !== "undefined",
        tronWeb: typeof win["tronWeb"] !== "undefined",
        tronLink: typeof win["tronLink"] !== "undefined",
        selectedAddress: tron.selectedAddress,
        chainId: tron.chainId,
      });
    } catch {
      // Diagnostics must never throw.
    }
  }

  win["tron"] = tron;
  if (!win["tronLink"]) win["tronLink"] = tron;
  if (!win["tronWeb"]) win["tronWeb"] = tronWeb;

  tronDebugLog("injected");

  // Hydrate on load so an already-connected dApp detects SIMPL immediately.
  hydrateTron();

  // EIP-6963: announce for multi-wallet dApps.
  const eip6963Info = {
    uuid: "b1a4c8d2-3f5e-4a7b-9c0d-1e2f3a4b5c6d",
    name: "SIMPL Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjMTExMTExIi8+PHRleHQgeD0iMTYiIHk9IjIxIiB0ZXh0LUFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iNzAwIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCBzYW5zLXNlcmlmIiBmaWxsPSJ3aGl0ZSI+UzwvdGV4dD48L3N2Zz4=",
    rdns: "com.simplwallet",
  };

  function announce(): void {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: eip6963Info, provider }),
      }),
    );
  }

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
