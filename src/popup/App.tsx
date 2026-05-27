import { useEffect, useState, useRef } from "react";
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
import { SwapPage } from "./routes/SwapPage";
import { TransactionHistoryPage } from "./routes/TransactionHistoryPage";
import { openSidePanel } from "./surface-actions";

import SeedBackupVerificationPage from "./routes/SeedBackupVerificationPage";
export type PopupRoute =
  | "welcome"
  | "create-wallet"
  | "import-wallet"
  | "unlock"
  | "home"
  | "receive"
  | "history"
  | "send"
  | "swap"
  | "accounts"
  | "add-watch-wallet"
  | "add-custom-token"
  | "reveal-seed"
  | "reveal-private-key"
  | "settings"  | "verify-seed-backup";

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
  const lastActivityAtRef = useRef(Date.now());
  const autoLockRunningRef = useRef(false);

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

  // SIMPLE auto-lock engine.
  // Locks wallet after configured inactivity timeout.
  useEffect(() => {
    if (!viewState || viewState.runtimeState.status !== "unlocked") {
      return;
    }

    lastActivityAtRef.current = Date.now();

    const markActivity = () => {
      lastActivityAtRef.current = Date.now();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, {
        passive: true,
      });
    });

    const intervalId = window.setInterval(async () => {
      if (autoLockRunningRef.current) {
        return;
      }

      const now = Date.now();
      const overview = await walletService.getOverview();

      if (overview.runtimeState.status !== "unlocked") {
        return;
      }

      const autoLockMinutes =
        overview.walletState?.settings.autoLockMinutes ??
        viewState.walletState?.settings.autoLockMinutes ??
        15;

      if (!Number.isFinite(autoLockMinutes) || autoLockMinutes <= 0) {
        return;
      }

      const timeoutMs = autoLockMinutes * 60 * 1000;
      const idleMs = now - lastActivityAtRef.current;

      if (idleMs < timeoutMs) {
        return;
      }

      autoLockRunningRef.current = true;

      try {
        walletService.lockWallet();
        setSelectedAsset(null);
        setRoute("unlock");
        await syncViewState();
      } finally {
        autoLockRunningRef.current = false;
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);

      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
    };
  }, [
    viewState?.runtimeState.status,
    viewState?.walletState?.settings.autoLockMinutes,
  ]);

  useEffect(() => {
    const handleWalletLock = () => {
      walletService.lockWallet();
      setSelectedAsset(null);
      setRoute("unlock");
      void syncViewState();
    };

    window.addEventListener("simple-wallet:lock", handleWalletLock);

    return () => {
      window.removeEventListener("simple-wallet:lock", handleWalletLock);
    };
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

  function goHome() {
    setSelectedAsset(null);
    setRoute("home");
  }

  function renderRoute() {
    if (loading || !viewState) {
      return (
        <div className="ext-popup" data-screen-label="00 Loading">
          <div
            className="screen-body"
            style={{
              display: "grid",
              placeItems: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 12,
                justifyItems: "center",
              }}
            >
              <div className="tok">S</div>

              <div
                style={{
                  color: "var(--ink-3)",
                  fontSize: 13,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Loading wallet…
              </div>
            </div>
          </div>
        </div>
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
              setRoute("verify-seed-backup");
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

            case "verify-seed-backup":
        return (
          <SeedBackupVerificationPage
            allowBack={false}
            onVerified={async () => {
              await refresh();
              setRoute("home");
            }}
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
            onHistory={() => setRoute("history")}
            onRevealSeed={() => setRoute("reveal-seed")}
            onRevealPrivateKey={() => setRoute("reveal-private-key")}
            onSettings={() => setRoute("settings")}
            onAddCustomToken={() => setRoute("add-custom-token")}
            onSendAsset={openSendPage}
            onRefresh={refresh}
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
            onSwapCompleted={refresh}
          />
        );

      case "send":
        if (
          !viewState.walletState ||
          !viewState.selectedAccount ||
          !selectedAsset
        ) {
          goHome();
          return null;
        }

        return (
          <SendPage
            asset={selectedAsset}
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            onBack={goHome}
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

      case "history":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <TransactionHistoryPage
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

      <button
        type="button"
        className="surface-mode-button"
        onClick={() => void openSidePanel()}
        aria-label="Open side panel"
        title="Open side panel"
      >
        <SidePanelIcon />
      </button>
    </div>
  );
}

export default App;
