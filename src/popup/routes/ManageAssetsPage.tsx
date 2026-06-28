// src/popup/routes/ManageAssetsPage.tsx
//
// Full wallet screen for managing the asset list — adding a custom token and
// restoring assets that were hidden on the current network. Replaces the old
// "Manage assets" bottom sheet: it is rendered inside the .ext-popup card via an
// early return from HomePage (the same pattern as SelectNetworkPage), never as a
// modal/backdrop/sheet. Back returns to Home; hidden-asset and custom-token
// logic stays in HomePage and is reached through the callbacks below.

import { AssetIcon } from "../components/AssetIcon";
import { NetworkIcon } from "../components/NetworkIcon";
import { getNetworkDisplayName } from "../../core/networks/chain-registry";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import { t, useTranslation } from "../../i18n";

type ManageAssetsPageProps = {
  chainId: number;
  hiddenAssets: WalletAssetBalance[];
  onAddCustomToken: () => void;
  onRestore: (address: string) => void;
  onBack: () => void;
};

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ManageAssetsPage(props: ManageAssetsPageProps) {
  // Subscribe to language changes so every string re-renders on switch.
  useTranslation();
  const networkName = getNetworkDisplayName(props.chainId);

  return (
    <div className="ext-popup" data-screen-label="Manage Assets">
      <div className="bar-top">
        <button
          className="icbtn"
          type="button"
          onClick={props.onBack}
          aria-label={t("common.back")}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>
        </button>

        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {t("home.manageAssets")}
        </div>

        <span style={{ flex: 1 }} />

        {/* Read-only context chip — the network is already chosen on Home; this
            screen only acts on it, so the chip is not a selector here. */}
        <div className="net-chip" title={`Network: ${networkName}`}>
          <NetworkIcon
            chainId={props.chainId}
            networkName={networkName}
            size={16}
            showTestnetBadge={false}
          />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {networkName}
          </span>
        </div>
      </div>

      <div className="screen-body manage-assets-body">
        {/* Intro — compact in popup, roomier in fullscreen (scoped CSS). */}
        <section className="manage-assets-intro">
          <div className="t-h2 manage-assets-title">{t("home.manageAssets")}</div>
          <div className="manage-assets-subtitle">{t("home.manageAssetsSub")}</div>
        </section>

        <div className="row-list">
          {/* Add custom token — opens the existing AddCustomTokenPage flow. */}
          <button
            type="button"
            className="row assets-mgr-add-row"
            onClick={props.onAddCustomToken}
            style={{
              width: "100%",
              background: "transparent",
              border: 0,
              textAlign: "left",
            }}
          >
            <span className="assets-mgr-add-icon">+</span>
            <div className="body">
              <div className="nm">{t("home.addCustomToken")}</div>
              <div className="sub">{t("home.addCustomTokenSub")}</div>
            </div>
            <div className="num">
              <div className="v">›</div>
            </div>
          </button>

          {/* Hidden assets — current network only. */}
          {props.hiddenAssets.length > 0 ? (
            <>
              <div className="assets-mgr-section-sep">
                {t("home.hiddenAssets")}
              </div>
              {props.hiddenAssets.map((asset) => (
                <div key={asset.id} className="row" style={{ cursor: "default" }}>
                  <AssetIcon
                    ticker={asset.symbol}
                    logoURI={asset.logoUrl}
                    address={asset.contractAddress}
                    chainId={asset.chainId}
                    size={36}
                  />
                  <div className="body" style={{ opacity: 0.55 }}>
                    <div className="nm">{asset.name}</div>
                    <div className="sub">
                      {asset.symbol}
                      {asset.contractAddress
                        ? ` · ${truncateAddress(asset.contractAddress)}`
                        : ""}
                    </div>
                  </div>
                  <div className="num">
                    <button
                      type="button"
                      className="assets-mgr-restore-btn"
                      onClick={() => {
                        if (asset.contractAddress)
                          props.onRestore(asset.contractAddress);
                      }}
                    >
                      {t("common.show")}
                    </button>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="assets-mgr-empty">{t("home.noHiddenAssets")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ManageAssetsPage;
