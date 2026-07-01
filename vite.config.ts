// vite.config.ts

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// getsimpl-core is the shared source of truth. It lives in a sibling repo and
// exports raw TypeScript, so alias the package names straight to that source —
// no build/publish step, mirroring the dashboard's setup.
const corePkg = (name: string) =>
  resolve(__dirname, `../getsimpl-core/packages/${name}/src/index.ts`);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@getsimpl/core": corePkg("core"),
      "@getsimpl/chains": corePkg("chains"),
      "@getsimpl/formatters": corePkg("formatters"),
      "@getsimpl/accounts": corePkg("accounts"),
      "@getsimpl/assets": corePkg("assets"),
      "@getsimpl/balances": corePkg("balances"),
      "@getsimpl/portfolio": corePkg("portfolio"),
      "@getsimpl/activity": corePkg("activity"),
      "@getsimpl/errors": corePkg("errors"),
      "@getsimpl/swaps": corePkg("swaps"),
      "@getsimpl/bridges": corePkg("bridges"),
      "@getsimpl/shared-types": corePkg("shared-types"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        sidepanel: resolve(__dirname, "sidepanel.html"),
        walletconnectApproval: resolve(__dirname, "walletconnect-approval.html"),
        walletconnectOffscreen: resolve(__dirname, "walletconnect-offscreen.html"),
        serviceWorker: resolve(__dirname, "src/background/service-worker.ts"),
        dappApproval: resolve(__dirname, "dapp-approval.html"),
        content: resolve(__dirname, "src/content/content.ts"),
        inpage: resolve(__dirname, "src/inpage/inpage.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "serviceWorker") {
            return "background/service-worker.js";
          }
          if (chunkInfo.name === "content") {
            return "assets/content.js";
          }
          if (chunkInfo.name === "inpage") {
            return "assets/inpage.js";
          }

          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});