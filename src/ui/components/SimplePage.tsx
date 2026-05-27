/// <reference types="chrome" />

import type { ReactNode } from "react";

type SimplePageProps = {
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
};

type SimpleSurface = "popup" | "sidepanel";

type ChromeActionWithOpenPopup = typeof chrome.action & {
  openPopup?: () => Promise<void>;
};

type ChromeSidePanelWithClose = typeof chrome.sidePanel & {
  close?: (options?: { tabId?: number; windowId?: number }) => Promise<void>;
};

function getCurrentSurface(): SimpleSurface {
  return document.documentElement.dataset.simpleSurface === "sidepanel"
    ? "sidepanel"
    : "popup";
}

async function getActiveTab() {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    return null;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tab ?? null;
}

async function openSidePanel() {
  try {
    if (
      typeof chrome === "undefined" ||
      !chrome.tabs?.query ||
      !chrome.sidePanel?.open
    ) {
      console.debug("Side panel API is not available.");
      return;
    }

    const tab = await getActiveTab();

    if (!tab?.id) {
      console.debug("Active tab was not found.");
      return;
    }

    await chrome.sidePanel.open({
      tabId: tab.id,
    });

    window.close();
  } catch (error) {
    console.error("Failed to open side panel:", error);
  }
}

async function openPopupFromSidePanel() {
  try {
    if (typeof chrome === "undefined") {
      console.debug("Chrome extension API is not available.");
      return;
    }

    const actionApi = chrome.action as ChromeActionWithOpenPopup;
    const sidePanelApi = chrome.sidePanel as ChromeSidePanelWithClose;

    if (actionApi.openPopup) {
      await actionApi.openPopup();
    }

    if (sidePanelApi.close) {
      const tab = await getActiveTab();

      if (tab?.windowId !== undefined) {
        await sidePanelApi.close({
          windowId: tab.windowId,
        });

        return;
      }

      if (tab?.id !== undefined) {
        await sidePanelApi.close({
          tabId: tab.id,
        });

        return;
      }
    }

    window.close();
  } catch (error) {
    console.error("Failed to open popup:", error);

    try {
      window.close();
    } catch {
      // ignore
    }
  }
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

export function SimplePage({
  children,
  className = "",
  actions,
}: SimplePageProps) {
  const surface = getCurrentSurface();
  const isSidePanel = surface === "sidepanel";

  return (
    <main className={`simple-page ${className}`}>
      <div className="simple-page-actions">
        {actions}

        <button
          type="button"
          className="simple-sidepanel-toggle"
          aria-label={isSidePanel ? "Open popup" : "Open in side panel"}
          title={isSidePanel ? "Open popup" : "Open in side panel"}
          onClick={() => {
            if (isSidePanel) {
              void openPopupFromSidePanel();
              return;
            }

            void openSidePanel();
          }}
        >
          {isSidePanel ? <PopupIcon /> : <SidePanelIcon />}
        </button>
      </div>

      <div className="simple-page__inner">{children}</div>
    </main>
  );
}