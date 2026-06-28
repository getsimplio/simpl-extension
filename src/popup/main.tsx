// Must be first: installs the Buffer/global polyfills @solana/web3.js needs at
// runtime, before any Solana code (reached via walletService) is evaluated.
import "../polyfills/buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

import { initThemeEarly } from "../core/theme/theme";
import { initLocaleEarly } from "../i18n";
import { storageRepository } from "../core/storage/storage.repository";
import { openFullscreenApp } from "./surface-actions";

// Apply the saved appearance + language before the first paint to avoid a flash
// of the light theme / English text.
initThemeEarly();
initLocaleEarly();

const isFullscreenSurface =
  new URLSearchParams(window.location.search).get("surface") === "fullscreen";

if (isFullscreenSurface) {
  document.documentElement.setAttribute("data-simple-surface", "fullscreen");
}

function render() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// When the user picked "Full page" as their default open mode, the toolbar still
// opens this popup (Chrome can only point the action at a popup or the side
// panel), so the popup hands off to a centered full-page tab and closes itself.
// Guards keep this safe: only the real popup redirects — never the full-page tab
// itself (surface=fullscreen) and never the side panel (a separate entry point).
// Any failure falls through to rendering the popup, so the user is never stuck.
async function boot() {
  if (!isFullscreenSurface) {
    try {
      const { settings } = await storageRepository.getWalletState();
      if (settings.defaultOpenMode === "fullscreen") {
        await openFullscreenApp();
        window.close();
        return;
      }
    } catch (error) {
      console.debug("Open-mode check failed; showing popup:", error);
    }
  }

  render();
}

void boot();