// src/popup/components/DestChainSelect.tsx
//
// Destination-chain selector for the unified, chain-aware Swap screen. The "To"
// section shows this pill: pick the same chain for a same-chain swap, or a
// different chain to make it a cross-chain swap. Selection only — it holds no
// quote or execution logic.
//
// The picker is a compact wallet sheet: search at the top, then chains ordered
// by relevance — the current chain, Simpl's executable chains (Ethereum, BNB
// Chain, Base), Solana, then the rest of the LI.FI chains. Chains Simpl can't
// fully execute yet are tagged "Preview only". Chain options load lazily from
// the Simpl API LI.FI proxy the first time the picker opens; until then the
// local EVM registry chains show instantly. No secrets/raw payloads surface.

import { useEffect, useMemo, useState } from "react";
import {
  getBridgeChains,
  isSignableSourceChain,
  type BridgeChain,
} from "../../core/bridge/lifi-bridge.service";
import {
  DEFAULT_CHAINS,
  getNetworkDisplayName,
} from "../../core/networks/chain-registry";
import { ChainPillButton } from "./ChainPillButton";
import { ChainIcon } from "./ChainIcon";

type ChainOption = {
  id: number;
  name: string;
  logoUrl: string | null;
  // Simpl can fully execute swaps from this chain (signable EVM in the registry).
  supported: boolean;
  isSolana: boolean;
};

// Simpl's fully-executable chains (kept first, untagged). Mirrors the signable
// EVM set; everything else is shown as a preview-only destination.
const EXECUTABLE_IDS = new Set<number>([1, 56, 8453]);

// Registry-derived quick options shown before the LI.FI list loads. Restricted
// to EVM mainnets, whose registry chainId equals the real (and LI.FI) chain id —
// non-EVM chains use internal sentinel ids that must NOT be sent as a LI.FI
// chain, so those only appear once the LI.FI list has loaded.
const REGISTRY_OPTIONS: ChainOption[] = DEFAULT_CHAINS.filter(
  (c) => c.family === "evm" && !c.isTestnet,
).map((c) => ({
  id: c.chainId,
  name: c.displayName,
  logoUrl: null,
  supported: isSignableSourceChain(c.chainId),
  isSolana: false,
}));

type DestChainSelectProps = {
  sourceChainId: number;
  value: number;
  onChange: (chainId: number) => void;
  disabled?: boolean;
};

export function DestChainSelect({
  sourceChainId,
  value,
  onChange,
  disabled,
}: DestChainSelectProps) {
  const [open, setOpen] = useState(false);
  const [chains, setChains] = useState<BridgeChain[]>([]);
  const [search, setSearch] = useState("");

  // Lazy-load the full chain list the first time the picker opens.
  useEffect(() => {
    if (!open || chains.length > 0) return;
    let active = true;
    void (async () => {
      try {
        const list = await getBridgeChains();
        if (active) setChains(list);
      } catch {
        // Keep the registry fallback options on failure.
      }
    })();
    return () => {
      active = false;
    };
  }, [open, chains.length]);

  const options = useMemo<ChainOption[]>(() => {
    const base: ChainOption[] =
      chains.length > 0
        ? chains.map((c) => ({
            id: c.id,
            name: c.name,
            logoUrl: c.logoUrl,
            supported: isSignableSourceChain(c.id),
            isSolana: c.chainType.toUpperCase() === "SVM",
          }))
        : REGISTRY_OPTIONS;

    // Always offer the current source chain (so the user can return to a
    // same-chain swap) even if it isn't in the list.
    if (!base.some((o) => o.id === sourceChainId)) {
      base.unshift({
        id: sourceChainId,
        name: getNetworkDisplayName(sourceChainId),
        logoUrl: null,
        supported: isSignableSourceChain(sourceChainId),
        isSolana: false,
      });
    }

    const q = search.trim().toLowerCase();
    const filtered = q
      ? base.filter((o) => o.name.toLowerCase().includes(q))
      : base;

    // Relevance order: current chain → executable chains → Solana → others.
    const rank = (o: ChainOption): number => {
      if (o.id === sourceChainId) return 0;
      if (EXECUTABLE_IDS.has(o.id)) return 1;
      if (o.isSolana) return 2;
      return 3;
    };
    return [...filtered].sort((a, b) => {
      const r = rank(a) - rank(b);
      return r !== 0 ? r : a.name.localeCompare(b.name);
    });
  }, [chains, sourceChainId, search]);

  const label = useMemo(() => {
    const fromLoaded = chains.find((c) => c.id === value)?.name;
    return fromLoaded ?? getNetworkDisplayName(value);
  }, [chains, value]);

  const valueLogo = useMemo(
    () => chains.find((c) => c.id === value)?.logoUrl ?? null,
    [chains, value],
  );

  return (
    <>
      <ChainPillButton
        chainId={value}
        name={label}
        logoUrl={valueLogo}
        disabled={disabled}
        onClick={() => {
          setSearch("");
          setOpen(true);
        }}
        ariaLabel={`Destination chain: ${label}`}
      />

      {open ? (
        <div
          className="swap-token-modal-backdrop"
          onClick={() => setOpen(false)}
        >
          <div
            className="swap-token-modal swap-chain-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="swap-token-modal-header">
              <div>
                <h2>Destination chain</h2>
                <p>Same chain swaps; a different chain swaps cross-chain.</p>
              </div>
              <button
                className="icbtn"
                type="button"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <input
              className="swap-picker-search"
              placeholder="Search chains"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="swap-token-list">
              {options.map((option) => (
                <button
                  key={option.id}
                  className="swap-token-list-item"
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <ChainIcon
                    chainId={option.id}
                    name={option.name}
                    logoUrl={option.logoUrl}
                    size={28}
                  />
                  <span className="swap-token-list-body">
                    <strong>
                      {option.name}
                      {option.id === sourceChainId ? (
                        <span className="swap-chain-row__tag">Current</span>
                      ) : !option.supported ? (
                        <span className="swap-chain-row__tag">Preview only</span>
                      ) : null}
                    </strong>
                    <span>
                      {option.id === sourceChainId
                        ? "Same-chain swap"
                        : "Cross-chain swap"}
                    </span>
                  </span>
                </button>
              ))}
              {options.length === 0 ? (
                <div className="swap-picker-empty">No matches.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
