// Must be first: installs the Buffer/global polyfills @solana/web3.js needs at
// runtime, before any Solana code (reached via walletService) is evaluated.
import "../polyfills/buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../popup/App";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

import { initThemeEarly } from "../core/theme/theme";
import { initLocaleEarly } from "../i18n";

// Apply the saved appearance + language before the first paint to avoid a flash
// of the light theme / English text.
initThemeEarly();
initLocaleEarly();

document.documentElement.setAttribute("data-simple-surface", "sidepanel");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);