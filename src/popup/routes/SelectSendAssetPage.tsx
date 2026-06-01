// src/popup/routes/SelectSendAssetPage.tsx
//
// Full-screen asset picker for the Send flow (replaces the old bottom-sheet).
// Rendered inside the wallet card via an early return in SendPage — no modal,
// backdrop, blur, or close X. Self-contained (owns its own search state) so it
// can later back a shared AssetSelectPage for Swap / Receive too.

import { useMemo, useState } from "react";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import { AssetIcon } from "../components/AssetIcon";

type SelectSendAssetPageProps = {
  // Assets available on the current network (unfiltered by search).
  assets: WalletAssetBalance[];
  selectedAssetId: string;
  // Canonical network name, shown as the header subtitle (e.g. "BNB Chain").
  networkLabel: string;
  hideBalances: boolean;
  onSelect: (asset: WalletAssetBalance) => void;
  onBack: () => void;
};

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// Balance formatting mirrors SendPage so the picker and form agree.
function formatBalance(asset: WalletAssetBalance): string {
  const value = Number(asset.formatted);
  if (!Number.isFinite(value)) return asset.formatted;
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";
  if (value < 1) return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return value.toLocaleString("en-US", {
    maximumFractionDigits: asset.decimals === 6 ? 2 : 6,
  });
}

// Fiat value from the existing price data on the balance object (no new fetch,
// no fake prices). "No price" when unavailable.
function formatFiat(usdValue?: string | null): string {
  if (usdValue == null) return "No price";
  const value = Number(usdValue);
  if (!Number.isFinite(value)) return "No price";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

// Subtitle: native → "Native asset", imported → "Imported", else the symbol.
function assetSubtitle(asset: WalletAssetBalance): string {
  if (asset.type === "native") return "Native asset";
  if (asset.source === "custom") return "Imported";
  return asset.symbol;
}

export function SelectSendAssetPage({
  assets,
  selectedAssetId,
  networkLabel,
  hideBalances,
  onSelect,
  onBack,
}: SelectSendAssetPageProps) {
  const [query, setQuery] = useState("");

  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = q
      ? assets.filter(
          (item) =>
            item.symbol.toLowerCase().includes(q) ||
            item.name.toLowerCase().includes(q) ||
            (item.contractAddress?.toLowerCase().includes(q) ?? false),
        )
      : assets.slice();

    // Native first, then non-zero balances (desc), then the rest.
    return filtered.sort((a, b) => {
      if (a.type === "native" && b.type !== "native") return -1;
      if (b.type === "native" && a.type !== "native") return 1;

      const balA = Number(a.formatted) || 0;
      const balB = Number(b.formatted) || 0;
      const aNonZero = balA > 0;
      const bNonZero = balB > 0;
      if (aNonZero && !bNonZero) return -1;
      if (bNonZero && !aNonZero) return 1;

      return balB - balA;
    });
  }, [assets, query]);

  return (
    <div className="ext-popup asset-select-page" data-screen-label="Select asset">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>

        <div className="asset-select-titlebox">
          <div className="asset-select-title">Select asset</div>
          <div className="asset-select-subtitle">{networkLabel}</div>
        </div>

        <span style={{ width: 32, flexShrink: 0 }} />
      </div>

      <div className="screen-body asset-select-body">
        <div className="asset-select-search-wrap">
          <input
            className="asset-select-search"
            type="text"
            placeholder="Search symbol or address"
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="asset-select-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="asset-select-list">
          {visibleAssets.length === 0 ? (
            <div className="asset-select-empty">No assets found</div>
          ) : (
            visibleAssets.map((item) => {
              const active = item.id === selectedAssetId;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`asset-select-row${active ? " asset-select-row--active" : ""}`}
                  onClick={() => onSelect(item)}
                  aria-pressed={active}
                >
                  <AssetIcon
                    ticker={item.symbol}
                    logoURI={item.logoUrl}
                    address={item.contractAddress}
                    chainId={item.chainId}
                    size={38}
                  />

                  <div className="asset-select-row__body">
                    <div className="asset-select-row__name">
                      {item.name || item.symbol}
                    </div>
                    <div className="asset-select-row__sub">
                      {assetSubtitle(item)}
                    </div>
                  </div>

                  <div className="asset-select-row__num">
                    <div className="asset-select-row__bal">
                      {hideBalances ? "••••" : formatBalance(item)}
                    </div>
                    <div className="asset-select-row__fiat">
                      {hideBalances ? "" : formatFiat(item.usdValue)}
                    </div>
                  </div>

                  {active ? (
                    <span className="asset-select-row__check" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default SelectSendAssetPage;
