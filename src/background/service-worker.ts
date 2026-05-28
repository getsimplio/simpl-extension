/// <reference types="chrome" />

import { walletService } from "../core/wallet/wallet.service";



function disableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    console.debug("chrome.sidePanel API is not available.");
    return;
  }

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .then(() => {
      console.log("Side panel on action click disabled.");
    })
    .catch((error) => {
      console.error("Failed to disable side panel behavior:", error);
    });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Local EVM Wallet extension installed.");
  disableSidePanelOnActionClick();
  void pingWalletConnectEngine();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Local EVM Wallet extension started.");
  disableSidePanelOnActionClick();
  void pingWalletConnectEngine();
});

// Also run once when service worker is evaluated.
disableSidePanelOnActionClick();

type SimpleRuntimeMessage = {
  type?: string;
};

let walletConnectApprovalWindowId: number | null = null;

async function openWalletConnectApprovalWindow() {
  const url = chrome.runtime.getURL("walletconnect-approval.html?surface=approval");

  const popupWidth = 460;
  const popupHeight = 820;

  let left: number | undefined;
  let top: number | undefined;

  try {
    const currentWindow = await chrome.windows.getLastFocused();

    if (
      typeof currentWindow.left === "number" &&
      typeof currentWindow.top === "number" &&
      typeof currentWindow.width === "number"
    ) {
      left = Math.max(
        0,
        currentWindow.left + currentWindow.width - popupWidth - 24,
      );
      top = Math.max(0, currentWindow.top + 72);
    }
  } catch (error) {
    console.warn("Failed to calculate approval window position:", error);
  }

  const createdWindow = await chrome.windows.create({
    url,
    type: "popup",
    width: popupWidth,
    height: popupHeight,
    focused: true,
    ...(typeof left === "number" ? { left } : {}),
    ...(typeof top === "number" ? { top } : {}),
  });

  return createdWindow?.id;
}

chrome.windows?.onRemoved?.addListener((windowId) => {
  if (walletConnectApprovalWindowId === windowId) {
    walletConnectApprovalWindowId = null;
  }
});

chrome.runtime.onMessage.addListener(
  (
    message: SimpleRuntimeMessage,
    _sender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message?.type !== "SIMPLE_OPEN_WALLETCONNECT_APPROVAL_WINDOW") {
      return false;
    }

    void openWalletConnectApprovalWindow()
      .then((windowId) => {
        sendResponse({
          ok: true,
          windowId,
        });
      })
      .catch((error) => {
        console.error("Failed to open WalletConnect approval window:", error);

        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  },
);


const WALLETCONNECT_OFFSCREEN_DOCUMENT_PATH = "walletconnect-offscreen.html";

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenApi = (chrome as unknown as {
    offscreen?: {
      hasDocument?: () => Promise<boolean>;
    };
  }).offscreen;

  if (typeof offscreenApi?.hasDocument === "function") {
    return offscreenApi.hasDocument();
  }

  const clientsApi = (globalThis as unknown as {
    clients?: {
      matchAll?: () => Promise<Array<{ url?: string }>>;
    };
  }).clients;

  if (typeof clientsApi?.matchAll !== "function") {
    return false;
  }

  const extensionUrl = chrome.runtime.getURL(WALLETCONNECT_OFFSCREEN_DOCUMENT_PATH);
  const matchedClients = await clientsApi.matchAll();

  return matchedClients.some((client) => client.url === extensionUrl);
}

async function ensureWalletConnectOffscreenDocument(): Promise<void> {
  const offscreenApi = (chrome as unknown as {
    offscreen?: {
      createDocument?: (input: {
        url: string;
        reasons: string[];
        justification: string;
      }) => Promise<void>;
    };
  }).offscreen;

  if (typeof offscreenApi?.createDocument !== "function") {
    console.warn("chrome.offscreen API is not available.");
    return;
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  await offscreenApi.createDocument({
    url: WALLETCONNECT_OFFSCREEN_DOCUMENT_PATH,
    reasons: ["LOCAL_STORAGE"],
    justification: "Keep WalletConnect sessions and requests active while the wallet UI is closed.",
  });
}

async function pingWalletConnectEngine(): Promise<void> {
  await ensureWalletConnectOffscreenDocument();

  // The offscreen document self-starts its WalletConnect engine.
  // Do not immediately send a ping here: on cold start the offscreen
  // script may not have registered its message listener yet.
}

void pingWalletConnectEngine();


chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== "SIMPLE_WALLETCONNECT_ENGINE_READY") {
    return false;
  }

  console.log("SIMPLE WalletConnect offscreen engine is ready.");

  return false;
});


function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message?.type === "SIMPLE_WALLETCONNECT_STORAGE_GET") {
    void chrome.storage.local
      .get(message.keys)
      .then((value) => {
        sendResponse({
          ok: true,
          value,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_STORAGE_SET") {
    void chrome.storage.local
      .set(message.items ?? {})
      .then(() => {
        sendResponse({
          ok: true,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_GET_SELECTED_ACCOUNT") {
    void walletService
      .bootstrap()
      .then((bootstrap) => {
        const selectedAccount = bootstrap.selectedAccount;

        if (!selectedAccount) {
          throw new Error("No selected SIMPLE account.");
        }

        sendResponse({
          ok: true,
          account: {
            address: selectedAccount.address,
            chainId: bootstrap.walletState.selectedChainId,
          },
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_SEND_PREPARED_TRANSACTION") {
    void walletService
      .sendSelectedPreparedTransaction({
        password: typeof message.password === "string" ? message.password : undefined,
        transaction: message.transaction,
      })
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_PERSONAL_SIGN") {
    void walletService
      .signSelectedPersonalMessage({
        password: typeof message.password === "string" ? message.password : undefined,
        params: message.params,
      })
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_SIGN_TYPED_DATA_V4") {
    void walletService
      .signSelectedTypedDataV4({
        password: typeof message.password === "string" ? message.password : undefined,
        params: message.params,
      })
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  return false;
});
