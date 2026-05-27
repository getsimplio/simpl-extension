import React from "react";
import ReactDOM from "react-dom/client";
import WalletConnectPage from "./routes/WalletConnectPage";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

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
