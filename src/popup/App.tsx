import { useEffect, useState } from "react";
import { walletService } from "../core/wallet/wallet.service";
import type { WalletAccount } from "../core/accounts/account.types";
import type { WalletRuntimeState } from "../core/wallet/wallet.types";
import type { WalletState } from "../core/storage/storage.types";
import type { WalletAssetBalance } from "../core/tokens/token-balance.service";

import { WelcomePage } from "./routes/WelcomePage";
import { CreateWalletPage } from "./routes/CreateWalletPage";
import { ImportWalletPage } from "./routes/ImportWalletPage";
import { UnlockPage } from "./routes/UnlockPage";
import { HomePage } from "./routes/HomePage";
import { AccountPage } from "./routes/AccountPage";
import { AddWatchWalletPage } from "./routes/AddWatchWalletPage";
import { AddCustomTokenPage } from "./routes/AddCustomTokenPage";
import { SendPage } from "./routes/SendPage";
import { RevealSeedPage } from "./routes/RevealSeedPage";
import { RevealPrivateKeyPage } from "./routes/RevealPrivateKeyPage";
import { SettingsPage } from "./routes/SettingsPage";
import { ReceivePage } from "./routes/ReceivePage";
import { openSidePanel } from "./surface-actions";
import { SwapPage } from "./routes/SwapPage";

export type PopupRoute =
  | "welcome"
  | "create-wallet"
  | "import-wallet"
  | "unlock"
  | "home"
  | "receive"
  | "send"
  | "swap"
  | "accounts"
  | "add-watch-wallet"
  | "add-custom-token"
  | "reveal-seed"
  | "reveal-private-key"
  | "settings";

export type PopupViewState = {
  runtimeState: WalletRuntimeState;
  walletState: WalletState | null;
  selectedAccount: WalletAccount | null;
};

function SidePanelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="M14 5v14" />
    </svg>
  );
}

export function App() {
  const [route, setRoute] = useState<PopupRoute>("welcome");
  const [viewState, setViewState] = useState<PopupViewState | null>(null);
  const [selectedAsset, setSelectedAsset] =
    useState<WalletAssetBalance | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const overview = await walletService.getOverview();

    const nextViewState: PopupViewState = {
      runtimeState: overview.runtimeState,
      walletState: overview.walletState,
      selectedAccount: overview.selectedAccount,
    };

    setViewState(nextViewState);

    if (overview.runtimeState.status === "not_initialized") {
      setSelectedAsset(null);
      setRoute("welcome");
      return;
    }

    if (overview.runtimeState.status === "locked") {
      setSelectedAsset(null);
      setRoute("unlock");
      return;
    }

    setSelectedAsset(null);
    setRoute("home");
  }

  async function syncViewState() {
    const overview = await walletService.getOverview();

    const nextViewState: PopupViewState = {
      runtimeState: overview.runtimeState,
      walletState: overview.walletState,
      selectedAccount: overview.selectedAccount,
    };

    setViewState(nextViewState);

    if (overview.runtimeState.status === "not_initialized") {
      setSelectedAsset(null);
      setRoute("welcome");
      return;
    }

    if (overview.runtimeState.status === "locked") {
      setSelectedAsset(null);
      setRoute("unlock");
    }
  }

  useEffect(() => {
    refresh().finally(() => {
      setLoading(false);
    });
  }, []);

  function getAddWatchWalletBackRoute(): PopupRoute {
    if (!viewState || viewState.runtimeState.status === "not_initialized") {
      return "welcome";
    }

    return "accounts";
  }

  function openSendPage(asset: WalletAssetBalance) {
    setSelectedAsset(asset);
    setRoute("send");
  }

  function renderRoute() {
    if (loading || !viewState) {
      return (
        <section className="simple-page simple-loading-page">
          <div className="simple-card simple-loading-card">
            <div className="simple-logo">
              <span className="simple-logo__mark" aria-hidden="true" />
              <span className="simple-logo__text">SIMPLE</span>
            </div>

            <p className="simple-loading-text">Loading wallet...</p>
          </div>
        </section>
      );
    }

    switch (route) {
      case "welcome":
        return (
          <WelcomePage
            onCreateWallet={() => setRoute("create-wallet")}
            onImportWallet={() => setRoute("import-wallet")}
            onAddWatchWallet={() => setRoute("add-watch-wallet")}
          />
        );

      case "create-wallet":
        return (
          <CreateWalletPage
            onCreated={async () => {
              await refresh();
            }}
            onBack={() => setRoute("welcome")}
          />
        );

      case "import-wallet":
        return (
          <ImportWalletPage
            onImported={async () => {
              await refresh();
            }}
            onBack={() => setRoute("welcome")}
          />
        );

      case "unlock":
        return (
          <UnlockPage
            walletState={viewState.walletState}
            onUnlocked={async () => {
              await refresh();
            }}
            onRestoreFromSeed={() => setRoute("import-wallet")}
          />
        );

      case "home":
        if (!viewState.walletState) {
          return null;
        }

        return (
  <HomePage
    selectedAccount={viewState.selectedAccount}
    walletState={viewState.walletState}
    onAccounts={() => setRoute("accounts")}
    onReceive={() => setRoute("receive")}
    onSwap={() => setRoute("swap")}
    onRevealSeed={() => setRoute("reveal-seed")}
    onRevealPrivateKey={() => setRoute("reveal-private-key")}
    onSettings={() => setRoute("settings")}
    onAddCustomToken={() => setRoute("add-custom-token")}
    onSendAsset={openSendPage}
    onRefresh={refresh}
    onHistory={() => undefined}
  />
);

      case "swap":
  if (!viewState.walletState) {
    return null;
  }

  return (
    <SwapPage
      selectedAccount={viewState.selectedAccount}
      walletState={viewState.walletState}
      onBack={() => setRoute("home")}
    />
  );

      case "send":
        if (
          !viewState.walletState ||
          !viewState.selectedAccount ||
          !selectedAsset
        ) {
          return null;
        }

        return (
          <SendPage
            asset={selectedAsset}
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            onBack={() => {
              setSelectedAsset(null);
              setRoute("home");
            }}
            onSent={async () => {
              setSelectedAsset(null);
              await refresh();
            }}
          />
        );

      case "receive":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <ReceivePage
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            onBack={() => setRoute("home")}
          />
        );

      case "accounts":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <AccountPage
            walletState={viewState.walletState}
            onBack={() => setRoute("home")}
            onChanged={refresh}
            onAddWatchWallet={() => setRoute("add-watch-wallet")}
          />
        );

      case "add-watch-wallet":
        return (
          <AddWatchWalletPage
            onAdded={async () => {
              await refresh();
            }}
            onBack={() => {
              setRoute(getAddWatchWalletBackRoute());
            }}
          />
        );

      case "add-custom-token":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <AddCustomTokenPage
            walletState={viewState.walletState}
            selectedAccount={viewState.selectedAccount}
            onBack={() => setRoute("home")}
            onAdded={async () => {
              await syncViewState();
              setRoute("home");
            }}
          />
        );

      case "reveal-seed":
        return <RevealSeedPage onBack={() => setRoute("settings")} />;

      case "reveal-private-key":
        return <RevealPrivateKeyPage onBack={() => setRoute("settings")} />;

      case "settings":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <SettingsPage
            walletState={viewState.walletState}
            onBack={() => setRoute("home")}
            onChanged={syncViewState}
            onRevealSeed={() => setRoute("reveal-seed")}
            onRevealPrivateKey={() => setRoute("reveal-private-key")}
          />
        );

      default:
        return null;
    }
  }

  return (
    <div className="popup-app-shell">
      <main className="popup-app-frame" data-route={route}>
        {renderRoute()}
      </main>
    </div>
  );
}

export default App;