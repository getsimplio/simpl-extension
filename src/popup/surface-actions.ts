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

export async function openFullscreenApp(): Promise<void> {
  const url = getExtensionUrl("popup.html?surface=fullscreen");

  try {
    // Reuse an already-open full-page tab instead of stacking duplicates, so
    // repeatedly clicking the toolbar icon (in fullscreen mode) never spawns an
    // endless pile of tabs — it just refocuses the existing one.
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find((tab) =>
        tab.url?.includes("popup.html?surface=fullscreen"),
      );

      if (existing?.id != null) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId != null && chrome.windows?.update) {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
        return;
      }
    }

    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      await chrome.tabs.create({ url });
      return;
    }
  } catch (error) {
    console.debug("Could not open the full-page tab:", error);
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
