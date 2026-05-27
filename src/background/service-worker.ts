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