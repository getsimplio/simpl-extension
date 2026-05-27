/// <reference types="chrome" />



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
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Local EVM Wallet extension started.");
  disableSidePanelOnActionClick();
});

// Also run once when service worker is evaluated.
disableSidePanelOnActionClick();

type SimpleRuntimeMessage = {
  type?: string;
};

let walletConnectApprovalWindowId: number | null = null;

async function openWalletConnectApprovalWindow(): Promise<number | undefined> {
  const url = chrome.runtime.getURL("walletconnect-approval.html?surface=approval");

  if (walletConnectApprovalWindowId !== null) {
    try {
      await chrome.windows.update(walletConnectApprovalWindowId, {
        focused: true,
      });

      return walletConnectApprovalWindowId;
    } catch {
      walletConnectApprovalWindowId = null;
    }
  }

  const createdWindow = await chrome.windows.create({
    url,
    type: "popup",
    width: 440,
    height: 720,
    focused: true,
  });

  if (!createdWindow?.id) {
    throw new Error("WalletConnect approval window was not created.");
  }

  walletConnectApprovalWindowId = createdWindow.id;

  return createdWindow.id;
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
