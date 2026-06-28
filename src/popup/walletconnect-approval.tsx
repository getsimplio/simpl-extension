// Must be first: installs the Buffer/global polyfills @solana/web3.js needs at
// runtime, before the wallet.service chunk (which bundles it) is evaluated.
import "../polyfills/buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import WalletConnectPage from "./routes/WalletConnectPage";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

import { initThemeEarly } from "../core/theme/theme";
import { initLocaleEarly } from "../i18n";

// Apply the saved appearance + language before the first paint to avoid a flash
// of the light theme / English text.
initThemeEarly();
initLocaleEarly();

document.documentElement.setAttribute("data-simple-surface", "approval");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletConnectPage
      onBack={() => {
        window.close();
      }}
      onConnected={async () => {
        // Approval window can keep listening after connection if needed.
      }}
    />
  </React.StrictMode>,
);
