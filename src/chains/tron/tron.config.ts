// src/chains/tron/tron.config.ts
//
// TRON Mainnet configuration. The app routes every chain by a single numeric
// `chainId` (see core/networks/chain-registry.ts); TRON reuses its canonical
// EVM chain id 728126428 as that key. This module additionally exposes the
// human-readable "tron-mainnet" id and TRON-specific constants used only by the
// TRON adapter.

import { TRON_MAINNET_CHAIN_ID } from "../../core/networks/chain-registry";

export type TronChainConfig = {
  id: "tron-mainnet";
  family: "tron";
  // Numeric routing key shared with the rest of the wallet.
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
  explorerUrl: string;
};

export const TRON_MAINNET: TronChainConfig = {
  id: "tron-mainnet",
  family: "tron",
  chainId: TRON_MAINNET_CHAIN_ID,
  name: "TRON",
  symbol: "TRX",
  decimals: 6,
  rpcUrl: "https://api.trongrid.io",
  explorerUrl: "https://tronscan.org",
};

// BIP-44 coin type for TRON. Used to build m/44'/195'/0'/0/{index}.
export const TRON_COIN_TYPE = 195;

// TRX uses 6 decimals; 1 TRX = 1_000_000 sun.
export const TRX_DECIMALS = 6;
export const SUN_PER_TRX = 1_000_000n;

// Conservative fee ceiling (in sun) for TRC-20 transfers. 100 TRX is well above
// a normal USDT transfer cost and protects the user from a runaway energy bill
// while still letting the transfer through when the account lacks energy.
export const TRC20_DEFAULT_FEE_LIMIT_SUN = 100_000_000;

export function getTronTransactionExplorerUrl(txId: string): string {
  return `${TRON_MAINNET.explorerUrl}/#/transaction/${txId}`;
}

export function getTronAddressExplorerUrl(address: string): string {
  return `${TRON_MAINNET.explorerUrl}/#/address/${address}`;
}

export function getTronTokenExplorerUrl(contractAddress: string): string {
  return `${TRON_MAINNET.explorerUrl}/#/token20/${contractAddress}`;
}
