// src/chains/ton/ton.config.ts
//
// TON (The Open Network, Ed25519, smart-contract wallet) network configuration.
// The app routes every chain by a single numeric `chainId` (see
// core/networks/chain-registry.ts); TON has no canonical numeric id, so it uses
// the internal sentinel id defined there. This module exposes the human
// "ton-mainnet" id, the configurable toncenter HTTP API endpoint, the Tonviewer
// explorer URL builders and TON constants used only by the TON adapter. No EVM
// chainId is ever used for TON.

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
  // Primary toncenter HTTP API base (no trailing slash). TON is account/contract
  // based and exposes an HTTP API rather than JSON-RPC.
  apiBaseUrl: string;
  // Optional toncenter API key (raises the anonymous rate limit). Empty by
  // default; set via VITE_TON_API_KEY for production.
  apiKey: string;
  // tonapi read API base — no trailing slash. Used for TON market data the simpl
  // gateway does NOT serve (the gateway has no TON support): the native Toncoin
  // spot price + chart, and Jetton balance discovery (balances + metadata +
  // verification in one call, which keeps spam/unknown jettons out of the
  // portfolio). Read-only; no signing ever touches it.
  tonapiBaseUrl: string;
  // Optional tonapi bearer token (raises the anonymous rate limit). Empty by
  // default; set via VITE_TONAPI_KEY for production.
  tonapiKey: string;
  // Human-facing block explorer (Tonviewer) base — no trailing slash.
  explorerUrl: string;
  isTestnet: boolean;
};

// Optional build-time override. In production this should point at a backend
// proxy or a keyed toncenter endpoint. `import.meta.env` is statically replaced
// by Vite; it is undefined under tsx/node, where this yields the defaults.
const env = import.meta.env as Record<string, string | undefined> | undefined;

function envString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

export const TON_MAINNET: TonChainConfig = {
  id: "ton-mainnet",
  family: "ton",
  chainId: TON_MAINNET_CHAIN_ID,
  name: "TON",
  symbol: "TON",
  decimals: 9,
  apiBaseUrl: envString(
    env?.VITE_TON_MAINNET_API_URL,
    "https://toncenter.com/api/v2",
  ),
  apiKey: envString(env?.VITE_TON_API_KEY, ""),
  tonapiBaseUrl: envString(env?.VITE_TONAPI_URL, "https://tonapi.io"),
  tonapiKey: envString(env?.VITE_TONAPI_KEY, ""),
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
