// src/popup/components/SelectNetworkPage.tsx
//
// THE single network selector used everywhere in the wallet (Home, Receive,
// Send, Swap). It is a full wallet screen rendered inside the .ext-popup card —
// never a modal, backdrop, or bottom sheet. Callers render it via an early
// return when their local "selector open" state is set, pass the current
// global chainId and a purpose (for context copy), and handle the actual
// network switch in onSelect. The list UI is identical across every caller.

import {
  DEFAULT_CHAINS,
  getNetworkDisplayName,
} from "../../core/networks/chain-registry";
import { t, useTranslation } from "../../i18n";
import { NetworkIcon } from "./NetworkIcon";

export type NetworkPurpose = "active" | "receive" | "send" | "swap";

// Optional per-chain availability (used by Receive's asset-specific mode to
// disable chains where a token doesn't exist). Omitted → every chain available.
export type NetworkAvailability = (chainId: number) => {
  available: boolean;
  reason?: string;
};

type SelectNetworkPageProps = {
  purpose: NetworkPurpose;
  selectedChainId: number;
  busyChainId?: number | null;
  error?: string | null;
  availability?: NetworkAvailability;
  onSelect: (chainId: number) => void;
  onBack: () => void;
};

// Context copy per purpose — layout stays identical, only the hint changes.
// Resolved via t() at render time so it stays reactive to language switches.
function purposeHint(purpose: NetworkPurpose): string {
  switch (purpose) {
    case "receive":
      return t("selectNetwork.hint.receive");
    case "send":
      return t("selectNetwork.hint.send");
    case "swap":
      return t("selectNetwork.hint.swap");
    case "active":
    default:
      return t("selectNetwork.hint.active");
  }
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function NetworkRow({
  chainId,
  selected,
  pending,
  disabled,
  reason,
  onSelect,
}: {
  chainId: number;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  reason?: string;
  onSelect: (chainId: number) => void;
}) {
  const chain = DEFAULT_CHAINS.find((item) => item.chainId === chainId);
  if (!chain) return null;

  // Short, never-truncated subtitle: "ERC-20 · Gas: ETH".
  const subtitle = disabled
    ? (reason ?? t("common.notAvailable"))
    : `${chain.standardLabel} · Gas: ${chain.nativeCurrency.symbol}`;

  return (
    <button
      type="button"
      className={`row select-network-row${
        selected ? " select-network-row--active" : ""
      }${disabled ? " select-network-row--disabled" : ""}`}
      onClick={() => !disabled && onSelect(chainId)}
      disabled={disabled || pending}
      aria-pressed={selected}
    >
      <NetworkIcon
        chainId={chainId}
        networkName={chain.name}
        size={38}
        showTestnetBadge={chain.isTestnet}
      />

      <div className="body select-network-row__body">
        <div className="nm select-network-row__name">
          <span className="select-network-row__name-text">
            {getNetworkDisplayName(chainId)}
          </span>
        </div>
        <div className="sub select-network-row__sub">{subtitle}</div>
      </div>

      <div className="num select-network-row__end">
        {chain.isTestnet ? (
          <span className="select-network-testnet-pill">{t("common.testnet")}</span>
        ) : null}
        {pending ? (
          <span className="select-network-pending">···</span>
        ) : selected ? (
          <span className="select-network-check" aria-label={t("common.selected")}>
            <CheckIcon />
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function SelectNetworkPage({
  purpose,
  selectedChainId,
  busyChainId,
  error,
  availability,
  onSelect,
  onBack,
}: SelectNetworkPageProps) {
  const { t } = useTranslation();
  const busy = busyChainId != null;

  const mainnets = DEFAULT_CHAINS.filter((chain) => !chain.isTestnet);
  const testnets = DEFAULT_CHAINS.filter((chain) => chain.isTestnet);

  const renderGroup = (label: string, chains: typeof DEFAULT_CHAINS) => {
    if (chains.length === 0) return null;

    return (
      <div className="select-network-group">
        <div className="select-network-group__label">{label}</div>
        <section className="row-list select-network-list">
          {chains.map((chain) => {
            const state = availability?.(chain.chainId) ?? { available: true };
            return (
              <NetworkRow
                key={chain.chainId}
                chainId={chain.chainId}
                selected={chain.chainId === selectedChainId}
                pending={busyChainId === chain.chainId}
                disabled={busy || !state.available}
                reason={state.reason}
                onSelect={onSelect}
              />
            );
          })}
        </section>
      </div>
    );
  };

  return (
    <div
      className="ext-popup select-network-page"
      data-screen-label="Select Network"
    >
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>

        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {t("selectNetwork.title")}
        </div>
      </div>

      <div className="screen-body select-network-body">
        <p className="select-network-hint">{purposeHint(purpose)}</p>

        {error ? <div className="receive-network-error">{error}</div> : null}

        {renderGroup(t("selectNetwork.mainnets"), mainnets)}
        {renderGroup(t("selectNetwork.testnets"), testnets)}
      </div>
    </div>
  );
}

export default SelectNetworkPage;
