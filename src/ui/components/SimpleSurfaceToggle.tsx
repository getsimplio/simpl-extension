import { useEffect, useState } from "react";

type SimpleSurface = "popup" | "sidepanel";

function getCurrentSurface(): SimpleSurface {
  return document.documentElement.dataset.simpleSurface === "sidepanel"
    ? "sidepanel"
    : "popup";
}

type SidePanelApiWithClose = typeof chrome.sidePanel & {
  close?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
};

type ActionApiWithOpenPopup = typeof chrome.action & {
  openPopup?: () => Promise<void>;
};

export function SimpleSurfaceToggle() {
  const [surface, setSurface] = useState<SimpleSurface>(getCurrentSurface);

  useEffect(() => {
    setSurface(getCurrentSurface());
  }, []);

  async function openSidePanel() {
    try {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.sidePanel?.open
      ) {
        return;
      }

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) return;

      await chrome.sidePanel.open({
        tabId: tab.id,
      });

      window.close();
    } catch (error) {
      console.error("Failed to open side panel:", error);
    }
  }

  async function openPopupAndCloseSidePanel() {
    try {
      const actionApi = chrome.action as ActionApiWithOpenPopup;
      const sidePanelApi = chrome.sidePanel as SidePanelApiWithClose;

      if (actionApi.openPopup) {
        await actionApi.openPopup();
      }

      if (sidePanelApi.close && chrome.windows?.getCurrent) {
        const currentWindow = await chrome.windows.getCurrent();

        if (currentWindow.id !== undefined) {
          await sidePanelApi.close({
            windowId: currentWindow.id,
          });

          return;
        }
      }

      window.close();
    } catch (error) {
      console.error("Failed to return to popup:", error);

      try {
        window.close();
      } catch {
        // ignore
      }
    }
  }

  return (
    <button
      type="button"
      className="simple-surface-toggle"
      aria-label={surface === "sidepanel" ? "Open popup" : "Open side panel"}
      title={surface === "sidepanel" ? "Open popup" : "Open side panel"}
      onClick={() => {
        if (surface === "sidepanel") {
          void openPopupAndCloseSidePanel();
          return;
        }

        void openSidePanel();
      }}
    >
      {surface === "sidepanel" ? <PopupIcon /> : <SidePanelIcon />}
    </button>
  );
}

function SidePanelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M14 5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PopupIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <rect
        x="5"
        y="6"
        width="14"
        height="12"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 10h8M8 14h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
