// src/popup/components/CrossChainTokenPicker.tsx
//
// Shared token selector that searches ACROSS supported production networks (not
// just the current one). The token is the primary object: each row shows the
// token with a small chain badge, the chain name in muted text, and (for held
// assets) a balance. Selecting a token returns its chain too, so the caller can
// switch that side's chain together with the token — a different chain than the
// other side becomes a cross-chain (LI.FI) route automatically.
//
// Rendered as a real wallet SCREEN (not a modal/bottom sheet): it occupies the
// wallet card via position:absolute inset:0 inside the page's `.ext-popup`
// (which is position:relative), exactly like the swap review / status pages.
// No backdrop, no blur, no "×" — a shared SwapHeader with a back button returns
// to the previous swap/bridge screen with its state intact. Works the same in
// popup, sidepanel and fullscreen (the centered card stays put).
//
// Production mainnets only — no devnet/testnet. Address paste is chain-type
// aware: an EVM contract address searches EVM chains; a Solana mint searches
// Solana; the two are never confused.

import { useEffect, useMemo, useState } from "react";
import {
  getBridgeTokensForChains,
  LIFI_SOLANA_CHAIN_ID,
  type BridgeToken,
} from "../../core/bridge/lifi-bridge.service";
import { SwapHeader } from "./SwapHeader";
import { TokenWithChainBadge } from "./TokenWithChainBadge";

export type PickerToken = {
  chainId: number;
  chainName: string;
  chainLogoUrl?: string | null;
  address: string; // LI.FI native marker for the native asset
  isNative: boolean;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string | null;
  // Present only for assets the user holds on the current side.
  balanceFormatted?: string | null;
};

type CrossChainTokenPickerProps = {
  side: "from" | "to";
  currentChainId: number;
  // Held assets to surface under "Your assets" (with balances).
  yourAssets?: PickerToken[];
  onSelect: (token: PickerToken) => void;
  onClose: () => void;
};

// Supported PRODUCTION bridge networks (mainnet only — no devnet/testnet).
const PRODUCTION_CHAINS: { id: number; name: string }[] = [
  { id: 1, name: "Ethereum" },
  { id: 56, name: "BNB Chain" },
  { id: 8453, name: "Base" },
  { id: LIFI_SOLANA_CHAIN_ID, name: "Solana" },
];

const CHAIN_NAME = new Map(PRODUCTION_CHAINS.map((c) => [c.id, c.name]));
const DISPLAY_CAP = 60;

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

function isEvmChain(chainId: number): boolean {
  return chainId !== LIFI_SOLANA_CHAIN_ID;
}

function toPickerToken(t: BridgeToken): PickerToken {
  return {
    chainId: t.chainId,
    chainName: CHAIN_NAME.get(t.chainId) ?? `Chain ${t.chainId}`,
    address: t.address,
    isNative: t.isNative,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoUrl: t.logoUrl,
  };
}

export function CrossChainTokenPicker({
  side,
  currentChainId,
  yourAssets = [],
  onSelect,
  onClose,
}: CrossChainTokenPickerProps) {
  const [catalog, setCatalog] = useState<PickerToken[]>([]);
  const [search, setSearch] = useState("");
  // "all" | "current" | a specific chain id.
  const [filter, setFilter] = useState<"all" | "current" | number>("all");

  // Load the cross-network token catalog once (one multi-chain request).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tokens = await getBridgeTokensForChains(
          PRODUCTION_CHAINS.map((c) => c.id),
        );
        if (active) setCatalog(tokens.map(toPickerToken));
      } catch {
        // Keep "Your assets" usable even if the catalog fails to load.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const q = search.trim();
  const qLower = q.toLowerCase();
  const isEvmAddr = EVM_ADDRESS_RE.test(q);
  const isSolMint = !isEvmAddr && SOLANA_MINT_RE.test(q) && q.length >= 32;

  function matchesChainFilter(chainId: number): boolean {
    if (filter === "all") return true;
    if (filter === "current") return chainId === currentChainId;
    return chainId === filter;
  }

  // Address-paste is chain-type aware: an EVM address only matches EVM chains; a
  // Solana mint only matches Solana — never the other way around.
  function matchesSearch(t: PickerToken): boolean {
    if (!q) return true;
    if (isEvmAddr) {
      return isEvmChain(t.chainId) && t.address.toLowerCase() === qLower;
    }
    if (isSolMint) {
      return t.chainId === LIFI_SOLANA_CHAIN_ID && t.address === q;
    }
    return (
      t.symbol.toLowerCase().includes(qLower) ||
      t.name.toLowerCase().includes(qLower)
    );
  }

  const yourFiltered = useMemo(
    () => yourAssets.filter((t) => matchesChainFilter(t.chainId) && matchesSearch(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yourAssets, filter, q, currentChainId],
  );

  const popular = useMemo(() => {
    const heldKeys = new Set(
      yourAssets.map((t) => `${t.chainId}:${t.address.toLowerCase()}`),
    );
    const seen = new Set<string>();
    const out: PickerToken[] = [];
    for (const t of catalog) {
      const key = `${t.chainId}:${t.address.toLowerCase()}`;
      if (heldKeys.has(key) || seen.has(key)) continue;
      if (!matchesChainFilter(t.chainId) || !matchesSearch(t)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= DISPLAY_CAP) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, yourAssets, filter, q, currentChainId]);

  const title =
    side === "from" ? "Select token to sell" : "Select token to receive";

  const filterChips: { key: "all" | "current" | number; label: string }[] = [
    { key: "all", label: "All networks" },
    { key: "current", label: "Current" },
    ...PRODUCTION_CHAINS.map((c) => ({ key: c.id, label: c.name })),
  ];

  function renderRow(t: PickerToken) {
    return (
      <button
        key={`${t.chainId}:${t.address}`}
        className="swap-token-list-item"
        type="button"
        onClick={() => onSelect(t)}
      >
        <TokenWithChainBadge
          symbol={t.symbol}
          tokenLogoUrl={t.logoUrl}
          tokenAddress={t.isNative ? null : t.address}
          chainId={t.chainId}
          chainName={t.chainName}
          chainLogoUrl={t.chainLogoUrl}
          size={32}
        />
        <span className="swap-token-list-body">
          <strong>{t.symbol}</strong>
          <span>
            {t.name}
            <span className="cc-token-chain"> · {t.chainName}</span>
          </span>
        </span>
        {t.balanceFormatted != null ? (
          <span className="swap-token-list-balance">{t.balanceFormatted}</span>
        ) : null}
      </button>
    );
  }

  const hasResults = yourFiltered.length > 0 || popular.length > 0;
  // Distinguish "still loading the catalog" from "loaded, but nothing matches".
  const isLoading = catalog.length === 0 && yourAssets.length === 0 && !hasResults;

  return (
    <div className="swap-token-picker-page" role="dialog" aria-modal="true">
      <SwapHeader title={title} subtitle="Search across networks" onBack={onClose} />

      <div className="cc-picker-sticky">
        <input
          className="swap-picker-search"
          placeholder="Search token, symbol, or address"
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="cc-filter-row">
          {filterChips.map((chip) => (
            <button
              key={String(chip.key)}
              type="button"
              className={`cc-chip${filter === chip.key ? " cc-chip--active" : ""}`}
              onClick={() => setFilter(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cc-picker-body">
        {yourFiltered.length > 0 ? (
          <>
            <div className="cc-group-label">Your assets</div>
            {yourFiltered.map(renderRow)}
          </>
        ) : null}
        {popular.length > 0 ? (
          <>
            <div className="cc-group-label">Popular</div>
            {popular.map(renderRow)}
          </>
        ) : null}
        {!hasResults ? (
          <div className="swap-picker-empty">
            {isLoading ? "Loading tokens…" : "No tokens found"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
