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
import { TransactionHistoryPage } from "./routes/TransactionHistoryPage";
import { TransactionDetailsPage } from "./routes/TransactionDetailsPage";
import type { TransactionHistoryItem } from "../core/transactions/transaction-history.service";
import { AccountPage } from "./routes/AccountPage";
import { AddAccountPage } from "./routes/AddAccountPage";
import { AccountDetailsPage } from "./routes/AccountDetailsPage";
import { AddWatchWalletPage } from "./routes/AddWatchWalletPage";
import { ImportAccountPage } from "./routes/ImportAccountPage";
import { AddCustomTokenPage } from "./routes/AddCustomTokenPage";
import { SendPage } from "./routes/SendPage";
import { RevealSeedPage } from "./routes/RevealSeedPage";
import { RevealPrivateKeyPage } from "./routes/RevealPrivateKeyPage";
import { SettingsPage } from "./routes/SettingsPage";
import { ReceivePage } from "./routes/ReceivePage";
import { openSidePanel } from "./surface-actions";
import { SwapPage } from "./routes/SwapPage";
import { BridgePage } from "./routes/BridgePage";
import { isTronChainId } from "../core/networks/chain-registry";
import { LIFI_TRON_NATIVE_ADDRESS } from "../core/bridge/lifi-bridge.service";

export type PopupRoute =
  | "welcome"
  | "create-wallet"
  | "import-wallet"
  | "unlock"
  | "home"
  | "receive"
  | "send"
  | "swap"
  | "bridge"
  | "accounts"
  | "add-account"
  | "account-details"
  | "add-watch-wallet"
  | "import-account"
  | "add-custom-token"
  | "reveal-seed"
  | "reveal-private-key"
  | "settings"
  | "transaction-history"
  | "transaction-details";

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
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionHistoryItem | null>(null);
  // Asset preselected as the receive/TO token when Swap is opened from an
  // asset details modal. null when Swap is opened from the main action.
  const [swapToAsset, setSwapToAsset] = useState<WalletAssetBalance | null>(
    null,
  );
  // Asset preselected as the cross-chain bridge SOURCE (FROM) when Swap is opened
  // for a TRON asset — TRON has no same-chain swap, so it goes to BridgePage.
  const [bridgeFromAsset, setBridgeFromAsset] =
    useState<WalletAssetBalance | null>(null);
  // Asset preselected when Receive is opened from asset details. null when
  // Receive is opened from the main action (defaults to native asset).
  const [receiveAsset, setReceiveAsset] = useState<WalletAssetBalance | null>(
    null,
  );
  // Account whose details/management screen is open (from the Accounts list).
  const [detailsAccount, setDetailsAccount] = useState<WalletAccount | null>(
    null,
  );
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

  // Open the swap screen. When an asset is provided (Swap from an asset
  // details modal), it becomes the preselected receive/TO token and the
  // selected network is aligned to the asset's chain. With no asset (main
  // Swap action) the page keeps its default token pair.
  async function openSwapPage(asset?: WalletAssetBalance) {
    // TRON has no same-chain swap; its assets are cross-chain BRIDGE SOURCES via
    // LI.FI. Open the cross-chain BridgePage with the asset preselected as the
    // FROM token — never the 0x same-chain SwapPage (which 400s for TRON).
    if (asset && isTronChainId(asset.chainId)) {
      setSwapToAsset(null);
      setBridgeFromAsset(asset);
      setRoute("bridge");
      return;
    }
    if (asset) {
      if (asset.chainId !== viewState?.walletState?.selectedChainId) {
        await walletService.setSelectedChainId(asset.chainId);
        await syncViewState();
      }
      setSwapToAsset(asset);
    } else {
      setSwapToAsset(null);
    }

    setRoute("swap");
  }

  // Open the receive screen. When an asset is provided (Receive from asset
  // details), it's shown as the receive asset and the selected network is
  // aligned to the asset's chain. With no asset the page shows the native
  // asset of the selected network.
  async function openReceivePage(asset?: WalletAssetBalance) {
    if (asset) {
      if (asset.chainId !== viewState?.walletState?.selectedChainId) {
        await walletService.setSelectedChainId(asset.chainId);
        await syncViewState();
      }
      setReceiveAsset(asset);
    } else {
      setReceiveAsset(null);
    }

    setRoute("receive");
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
    onReceive={(asset) => void openReceivePage(asset)}
    onSwap={(asset) => void openSwapPage(asset)}
    onRevealSeed={() => setRoute("reveal-seed")}
    onRevealPrivateKey={() => setRoute("reveal-private-key")}
    onSettings={() => setRoute("settings")}
    onAddCustomToken={() => setRoute("add-custom-token")}
    onSendAsset={openSendPage}
    onRefresh={refresh}
    onHistory={() => setRoute("transaction-history")}
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
      initialToAsset={swapToAsset}
      onChanged={syncViewState}
      onNavigateHome={() => {
        setSwapToAsset(null);
        setRoute("home");
      }}
      onBack={() => {
        setSwapToAsset(null);
        setRoute("home");
      }}
    />
  );

      case "bridge": {
        if (!viewState.walletState || !bridgeFromAsset) {
          return null;
        }
        const fromAsset = bridgeFromAsset;
        const fromIsNative = fromAsset.contractAddress == null;
        return (
          <BridgePage
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            initialFromChainId={fromAsset.chainId}
            initialFromToken={{
              chainId: fromAsset.chainId,
              // Native TRX uses LI.FI's base58 sentinel; a TRC-20 uses its
              // contract address (which is LI.FI's identifier).
              address: fromIsNative
                ? LIFI_TRON_NATIVE_ADDRESS
                : (fromAsset.contractAddress as string),
              symbol: fromAsset.symbol,
              name: fromAsset.name,
              decimals: fromAsset.decimals,
              isNative: fromIsNative,
              logoUrl: fromAsset.logoUrl ?? null,
            }}
            onBridgeCompleted={syncViewState}
            onNavigateHome={() => {
              setBridgeFromAsset(null);
              setRoute("home");
            }}
            onBack={() => {
              setBridgeFromAsset(null);
              setRoute("home");
            }}
          />
        );
      }


      case "transaction-history":
        if (!viewState?.selectedAccount || !viewState.walletState) {
          return null;
        }

        return (
          <TransactionHistoryPage
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            onBack={() => setRoute("home")}
            onViewTransaction={(item) => {
              setSelectedTransaction(item);
              setRoute("transaction-details");
            }}
          />
        );

      case "transaction-details":
        return (
          <TransactionDetailsPage
            item={selectedTransaction}
            onBack={() => {
              setSelectedTransaction(null);
              setRoute("transaction-history");
            }}
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
            onChanged={syncViewState}
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
            receiveAsset={receiveAsset}
            onBack={() => {
              setReceiveAsset(null);
              setRoute("home");
            }}
            onChanged={syncViewState}
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
            onAddAccount={() => setRoute("add-account")}
            onOpenAccountDetails={(account) => {
              setDetailsAccount(account);
              setRoute("account-details");
            }}
          />
        );

      case "add-account":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <AddAccountPage
            onBack={() => setRoute("accounts")}
            onChanged={refresh}
            onImportWallet={() => setRoute("import-account")}
            onAddWatchWallet={() => setRoute("add-watch-wallet")}
          />
        );

      case "account-details":
        if (!viewState.walletState || !detailsAccount) {
          return null;
        }

        return (
          <AccountDetailsPage
            account={detailsAccount}
            chainId={viewState.walletState.selectedChainId}
            isActive={
              detailsAccount.id === viewState.walletState.selectedAccountId
            }
            onBack={() => {
              setDetailsAccount(null);
              setRoute("accounts");
            }}
            onUseAccount={async () => {
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              setDetailsAccount(null);
              // refresh() re-syncs state and lands on Home with the new active
              // account.
              await refresh();
            }}
            onReceive={async () => {
              // Quick actions operate on the selected account, so switch to
              // this one first, then open the page.
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              setDetailsAccount(null);
              await syncViewState();
              setReceiveAsset(null);
              setRoute("receive");
            }}
            onSend={async () => {
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              await syncViewState();
              setDetailsAccount(null);
              // Send needs an asset — default to the account's native asset.
              try {
                const portfolio = await walletService.getSelectedPortfolio();
                const native =
                  portfolio.assets.find((asset) => asset.type === "native") ??
                  portfolio.assets[0] ??
                  null;
                if (native) {
                  setSelectedAsset(native);
                  setRoute("send");
                  return;
                }
              } catch {
                // Fall through to Home if balances can't be loaded.
              }
              setRoute("home");
            }}
            onSwap={async () => {
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              setDetailsAccount(null);
              await syncViewState();
              setSwapToAsset(null);
              setRoute("swap");
            }}
            onRenamed={async (updated) => {
              // Stay on the details screen with the new name; refresh the list.
              setDetailsAccount(updated);
              await syncViewState();
            }}
            onRemoved={async () => {
              setDetailsAccount(null);
              await refresh();
              setRoute("accounts");
            }}
          />
        );

      case "import-account":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <ImportAccountPage
            onBack={() => setRoute("accounts")}
            onImported={async () => {
              await refresh();
              setRoute("accounts");
            }}
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
            onChanged={syncViewState}
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

  const surface =
    new URLSearchParams(window.location.search).get("surface") === "fullscreen"
      ? "fullscreen"
      : "popup";

  const isFullscreen = surface === "fullscreen";
  const routeContent = renderRoute();

  return (
    <div className={`app-root app-root--${surface}`} data-surface={surface}>
      {isFullscreen ? (
        <div className="fullscreen-shell">
          <main className="fullscreen-wallet-frame" data-route={route}>
            {routeContent}
          </main>
        </div>
      ) : (
        <div className="popup-app-shell">
          <main className="popup-app-frame" data-route={route}>
            {routeContent}
          </main>
        </div>
      )}
    </div>
  );
}

export default App;