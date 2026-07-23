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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getBridgeTokensForChains,
  LIFI_SOLANA_CHAIN_ID,
  LIFI_TRON_CHAIN_ID,
  LIFI_TRON_NATIVE_ADDRESS,
  type BridgeToken,
} from "../../core/bridge/lifi-bridge.service";
import { TRON_TOKENS } from "../../chains/tron/tron.tokens";
import { useTranslation } from "../../i18n";
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
  // Optional availability gate (Stage 3 runtime-config projection): rows this
  // predicate rejects are filtered out of every section. Omitted → no gating.
  isTokenAllowed?: (token: PickerToken) => boolean;
  onSelect: (token: PickerToken) => void;
  onClose: () => void;
};

// Supported PRODUCTION bridge networks (mainnet only — no devnet/testnet). Chain
// ids come from the shared registry constants (LIFI_SOLANA/TRON_CHAIN_ID) — never
// a duplicate magic number. The row scrolls horizontally as the set grows.
const PRODUCTION_CHAINS: { id: number; name: string }[] = [
  { id: 1, name: "Ethereum" },
  { id: 56, name: "BNB Chain" },
  { id: 8453, name: "Base" },
  { id: LIFI_SOLANA_CHAIN_ID, name: "Solana" },
  { id: LIFI_TRON_CHAIN_ID, name: "TRON" },
];

const CHAIN_NAME = new Map(PRODUCTION_CHAINS.map((c) => [c.id, c.name]));
const DISPLAY_CAP = 60;

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;
// TRON base58 (T + 33 base58 chars) — checked BEFORE the Solana mint regex, which
// would otherwise also match a TRON address.
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

// EVM = not Solana AND not TRON. A TRON base58 address must never be treated as
// an EVM 0x address, and vice-versa.
function isEvmChain(chainId: number): boolean {
  return chainId !== LIFI_SOLANA_CHAIN_ID && chainId !== LIFI_TRON_CHAIN_ID;
}

// TRON tokens from the local registry (TRX native + USDT TRC-20), as picker rows.
// Seeded into the catalog so TRON always offers its core assets even when the
// LI.FI token list for TVM is sparse/unavailable. CRITICAL: native TRX uses LI.FI's
// TRON-specific base58 sentinel (NOT the EVM 0x000…0 zero address, which LI.FI
// rejects for TRON); USDT uses its base58 TRC-20 contract. Provider tokens (when
// present) win on merge, so provider decimals/logos are preferred and the seed
// address matches LI.FI's so there is no duplicate TRX row.
const TRON_REGISTRY_TOKENS: PickerToken[] = TRON_TOKENS.map((t) => ({
  chainId: LIFI_TRON_CHAIN_ID,
  chainName: "TRON",
  address: t.contractAddress ?? LIFI_TRON_NATIVE_ADDRESS,
  isNative: t.type === "native",
  symbol: t.symbol,
  name: t.name,
  decimals: t.decimals,
  logoUrl: null,
}));

// Merge provider tokens with the TRON registry seed, deduped by chain:address
// (provider entries take precedence — they already appear first).
function mergeWithTronRegistry(providerTokens: PickerToken[]): PickerToken[] {
  const seen = new Set(
    providerTokens.map((t) => `${t.chainId}:${t.address.toLowerCase()}`),
  );
  const out = [...providerTokens];
  for (const t of TRON_REGISTRY_TOKENS) {
    const key = `${t.chainId}:${t.address.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
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
  isTokenAllowed,
  onSelect,
  onClose,
}: CrossChainTokenPickerProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<PickerToken[]>([]);
  const [search, setSearch] = useState("");
  // "all" | "current" | a specific chain id. Filtering logic below is unchanged —
  // only its UI changed from a scrolling chip row to a compact dropdown selector.
  const [filter, setFilter] = useState<"all" | "current" | number>("all");
  // Local open/closed state for the network filter dropdown (UI only).
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  // Close the network dropdown on an outside click / tap.
  useEffect(() => {
    if (!filterOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [filterOpen]);

  // Load the cross-network token catalog once (one multi-chain request).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tokens = await getBridgeTokensForChains(
          PRODUCTION_CHAINS.map((c) => c.id),
        );
        if (active) {
          setCatalog(mergeWithTronRegistry(tokens.map(toPickerToken)));
        }
      } catch {
        // Keep "Your assets" usable even if the catalog fails to load — and still
        // seed the TRON core assets so TRON stays selectable offline.
        if (active) setCatalog([...TRON_REGISTRY_TOKENS]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const q = search.trim();
  const qLower = q.toLowerCase();
  const isEvmAddr = EVM_ADDRESS_RE.test(q);
  // TRON before Solana: a TRON T… address is also valid Solana-mint base58.
  const isTronAddr = !isEvmAddr && TRON_ADDRESS_RE.test(q);
  const isSolMint =
    !isEvmAddr && !isTronAddr && SOLANA_MINT_RE.test(q) && q.length >= 32;

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
    // A TRON base58 address matches ONLY TRON tokens (case-sensitive — base58 is
    // case-significant); it is never matched against EVM/Solana.
    if (isTronAddr) {
      return t.chainId === LIFI_TRON_CHAIN_ID && t.address === q;
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
    () =>
      yourAssets.filter(
        (t) =>
          matchesChainFilter(t.chainId) &&
          matchesSearch(t) &&
          (isTokenAllowed?.(t) ?? true),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yourAssets, filter, q, currentChainId, isTokenAllowed],
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
      if (!(isTokenAllowed?.(t) ?? true)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= DISPLAY_CAP) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, yourAssets, filter, q, currentChainId, isTokenAllowed]);

  const title =
    side === "from"
      ? t("swap.selectTokenToSell")
      : t("swap.selectTokenToReceive");

  const filterOptions: { key: "all" | "current" | number; label: string }[] = [
    { key: "all", label: t("swap.networkAll") },
    { key: "current", label: t("swap.networkCurrentFull") },
    ...PRODUCTION_CHAINS.map((c) => ({ key: c.id, label: c.name })),
  ];
  // The selector button's current value label.
  const filterLabel =
    filter === "all"
      ? t("swap.networkAll")
      : filter === "current"
        ? t("swap.networkCurrent")
        : CHAIN_NAME.get(filter) ?? `Chain ${filter}`;

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
  // The active network filter's display name, for a chain-specific empty state
  // ("No tokens found on TRON") instead of a bare "No tokens found".
  const selectedChainLabel =
    typeof filter === "number" ? CHAIN_NAME.get(filter) ?? null : null;

  return (
    <div className="swap-token-picker-page" role="dialog" aria-modal="true">
      <SwapHeader title={title} subtitle={t("swap.searchAcrossNetworks")} onBack={onClose} />

      <div className="cc-picker-sticky">
        <input
          className="swap-picker-search"
          placeholder={t("swap.searchTokenPickerPlaceholder")}
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Compact network filter selector — a single full-width button that opens
            a dropdown. Replaces the old horizontal chip row, which clipped on the
            narrow popup/fullscreen surface. */}
        <div className="cc-filter-select" ref={filterRef}>
          <button
            type="button"
            className="cc-filter-trigger"
            aria-haspopup="listbox"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <span className="cc-filter-trigger__label">
              {t("swap.networkFilter", { label: filterLabel })}
            </span>
            <span className="cc-filter-trigger__chevron" aria-hidden="true">
              ▾
            </span>
          </button>
          {filterOpen ? (
            <div className="cc-filter-menu" role="listbox">
              {filterOptions.map((opt) => {
                const active = filter === opt.key;
                return (
                  <button
                    key={String(opt.key)}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`cc-filter-option${active ? " cc-filter-option--active" : ""}`}
                    onClick={() => {
                      setFilter(opt.key);
                      setFilterOpen(false);
                    }}
                  >
                    <span>{opt.label}</span>
                    {active ? (
                      <span className="cc-filter-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="cc-picker-body">
        {yourFiltered.length > 0 ? (
          <>
            <div className="cc-group-label">{t("swap.yourAssets")}</div>
            {yourFiltered.map(renderRow)}
          </>
        ) : null}
        {popular.length > 0 ? (
          <>
            <div className="cc-group-label">{t("swap.popular")}</div>
            {popular.map(renderRow)}
          </>
        ) : null}
        {!hasResults ? (
          <div className="swap-picker-empty">
            {isLoading
              ? t("swap.loadingTokens")
              : selectedChainLabel
                ? t("swap.noTokensOnChain", { chain: selectedChainLabel })
                : t("swap.noTokensFound")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
