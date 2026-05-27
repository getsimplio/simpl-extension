import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../popup/App";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

document.documentElement.setAttribute("data-simple-surface", "sidepanel");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);