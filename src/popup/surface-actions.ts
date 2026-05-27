// src/popup/surface-actions.ts

function getExtensionUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }

  return path;
}

export async function openSidePanel(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({
        windowId: -2,
      });

      window.close();
      return;
    }
  } catch (error) {
    console.debug("Could not open side panel:", error);
  }

  window.open(getExtensionUrl("sidepanel.html"), "_blank", "noopener,noreferrer");
}

export function openFullscreenApp(): void {
  const url = getExtensionUrl("popup.html?surface=fullscreen");

  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
