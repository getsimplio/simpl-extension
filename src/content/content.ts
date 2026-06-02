// src/content/content.ts
// Runs in the extension's ISOLATED content script world.
// Bridges page postMessage (from inpage.ts) ↔ chrome.runtime messages (to service-worker).
// Wrapped in IIFE to avoid any global scope pollution.

(function () {
  "use strict";

  const SIMPL_REQ = "SIMPL_PROVIDER_REQUEST";
  const SIMPL_RES = "SIMPL_PROVIDER_RESPONSE";
  const SIMPL_EVT = "SIMPL_PROVIDER_EVENT";

  // Forward RPC requests from the inpage provider to the service worker.
  window.addEventListener("message", (ev: MessageEvent) => {
    // Only accept messages from the same window (not iframes or other origins).
    if (ev.source !== window) return;

    const d = ev.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object") return;
    if (d["type"] !== SIMPL_REQ) return;

    const id = d["id"] as string;
    const method = d["method"] as string;
    const params = d["params"] as unknown[];
    // "tron" for the TronLink-compatible provider; absent for the EVM provider.
    const namespace = d["namespace"] as string | undefined;

    chrome.runtime.sendMessage(
      {
        type: "SIMPL_DAPP_REQUEST",
        id,
        method,
        params,
        namespace,
        origin: location.origin,
      },
      (
        response: {
          ok: boolean;
          result?: unknown;
          error?: { code: number; message: string };
        } | null,
      ) => {
        if (chrome.runtime.lastError) {
          window.postMessage(
            {
              type: SIMPL_RES,
              id,
              error: {
                code: -32603,
                message: chrome.runtime.lastError.message ?? "Extension error",
              },
            },
            "*",
          );
          return;
        }

        if (!response) {
          window.postMessage(
            {
              type: SIMPL_RES,
              id,
              error: { code: -32603, message: "No response from extension" },
            },
            "*",
          );
          return;
        }

        if (response.ok) {
          window.postMessage({ type: SIMPL_RES, id, result: response.result }, "*");
        } else {
          window.postMessage({ type: SIMPL_RES, id, error: response.error }, "*");
        }
      },
    );
  });

  // Forward events pushed from the service worker (accountsChanged, chainChanged, etc.)
  // to the inpage provider via postMessage.
  chrome.runtime.onMessage.addListener(
    (message: {
      type?: string;
      event?: string;
      data?: unknown;
      namespace?: string;
    }) => {
      if (message?.type !== SIMPL_EVT) return false;
      window.postMessage(
        {
          type: SIMPL_EVT,
          event: message.event,
          data: message.data,
          namespace: message.namespace,
        },
        "*",
      );
      return false;
    },
  );
})();
