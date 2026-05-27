import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

const searchParams = new URLSearchParams(window.location.search);
const surface = searchParams.get("surface");

if (surface === "fullscreen") {
  document.documentElement.setAttribute("data-simple-surface", "fullscreen");
} else {
  document.documentElement.removeAttribute("data-simple-surface");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
