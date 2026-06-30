// src/chains/ton/ton.config.ts
//
// TON (The Open Network, Ed25519, smart-contract wallet) network configuration.
// The app routes every chain by a single numeric `chainId` (see
// core/networks/chain-registry.ts); TON has no canonical numeric id, so it uses
// the internal sentinel id defined there. This module exposes the human
// "ton-mainnet" id, the Simpl API TON proxy base, the Tonviewer explorer URL
// builders and TON constants used only by the TON adapter. No EVM chainId is
// ever used for TON.
//
// PROVIDER PROXY: all TON network reads/writes go through the Simpl API Worker
// (`api.getsimpl.io/v1/ton/*`), NEVER directly to tonapi.io / toncenter. The
// provider API keys live ONLY in the Worker's server-side secrets and never
// reach this client bundle. Signing always stays local in the extension; the
// proxy only ever receives a public address, a signed BOC, a tx hash and
// period/currency params.

import { TON_MAINNET_CHAIN_ID } from "../../core/networks/chain-registry";

export type TonNetworkId = "ton-mainnet";

export type TonChainConfig = {
  id: TonNetworkId;
  family: "ton";
  // Numeric routing key shared with the rest of the wallet.
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  // Simpl API TON proxy base (no trailing slash), e.g.
  // "https://api.getsimpl.io/v1/ton". Every TON request (account, prices,
  // jettons, send-boc, tx status) is built off this base. No provider keys are
  // ever attached client-side — the Worker holds them.
  apiBaseUrl: string;
  // Human-facing block explorer (Tonviewer) base — no trailing slash.
  explorerUrl: string;
  isTestnet: boolean;
};

// `import.meta.env` is statically replaced by Vite; it is undefined under
// tsx/node, where this yields the defaults.
const env = import.meta.env as Record<string, string | undefined> | undefined;

function envString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

// Simpl API gateway base URL. VITE_SIMPL_API_BASE_URL is preferred; we fall back
// to the existing VITE_SIMPL_API_URL used by the market-data/swap services, then
// to the public default. No trailing slash.
export const SIMPL_API_BASE_URL = envString(
  env?.VITE_SIMPL_API_BASE_URL ?? env?.VITE_SIMPL_API_URL,
  "https://api.getsimpl.io",
).replace(/\/$/, "");

// All TON provider traffic is proxied under this base by the getsimpl-api
// Worker. The Worker holds the tonapi/toncenter secrets; nothing sensitive is
// inlined here.
export const TON_API_BASE_URL = `${SIMPL_API_BASE_URL}/v1/ton`;

export const TON_MAINNET: TonChainConfig = {
  id: "ton-mainnet",
  family: "ton",
  chainId: TON_MAINNET_CHAIN_ID,
  // `name` is the NETWORK name (chainName) and stays "TON". `symbol` is the
  // native ASSET symbol, rebranded Toncoin → Gram (GRAM).
  name: "TON",
  symbol: "GRAM",
  decimals: 9,
  apiBaseUrl: TON_API_BASE_URL,
  explorerUrl: "https://tonviewer.com",
  isTestnet: false,
};

export const TON_NETWORKS: TonChainConfig[] = [TON_MAINNET];

// Toncoin uses 9 decimals; 1 TON = 1_000_000_000 nanoton.
export const TON_DECIMALS = 9;
export const NANOTON_PER_TON = 1_000_000_000n;

// SLIP-44 registered coin type for TON ("TON" / The Open Network).
export const TON_COIN_TYPE = 607;

export function getTonConfigByChainId(chainId: number): TonChainConfig | null {
  return TON_NETWORKS.find((network) => network.chainId === chainId) ?? null;
}

export function getRequiredTonConfigByChainId(chainId: number): TonChainConfig {
  const config = getTonConfigByChainId(chainId);

  if (!config) {
    throw new Error(`Unsupported TON chain id: ${chainId}`);
  }

  return config;
}

// Build a TON proxy endpoint URL off the config's Simpl API base. Centralizes
// the trailing-slash trim so every caller hits a consistent origin.
export function tonApiUrl(config: TonChainConfig, path: string): string {
  const base = config.apiBaseUrl.replace(/\/$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

// Tonviewer address page. Tonviewer accepts the user-friendly address verbatim.
export function getTonAddressExplorerUrl(
  config: TonChainConfig,
  address: string,
): string {
  return `${config.explorerUrl}/${address}`;
}

// Tonviewer jetton page, keyed by the jetton master address. Tonviewer renders
// the jetton's overview at the root path for its master address.
export function getTonJettonExplorerUrl(
  config: TonChainConfig,
  masterAddress: string,
): string {
  return `${config.explorerUrl}/${masterAddress}`;
}

// Tonviewer transaction page, keyed by the transaction hash (hex or base64).
export function getTonTransactionExplorerUrl(
  config: TonChainConfig,
  txHash: string,
): string {
  return `${config.explorerUrl}/transaction/${txHash}`;
}
