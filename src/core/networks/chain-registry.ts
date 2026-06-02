// src/core/networks/chain-registry.ts

export type ChainId = number;

// Address/transaction family a chain belongs to. EVM chains share ethers-based
// derivation, balances, signing and RPC; "tron" routes to the TRON adapter.
// Chains keep a single numeric `chainId` as their routing key everywhere in the
// app (TRON uses its canonical EVM chain id 728126428 as that key) so existing
// EVM plumbing is untouched; `family` is the discriminator that selects the
// adapter.
export type ChainFamily = "evm" | "tron";

export type ChainConfig = {
  chainId: ChainId;
  family: ChainFamily;
  name: string;
  // Canonical user-facing network name, consistent across the whole app
  // (e.g. "BNB Chain", never "BNB Smart Chain"; "Ethereum", never
  // "Ethereum Mainnet"). UI label only — does not affect network logic.
  displayName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  blockExplorerUrl: string;
  isTestnet: boolean;
  // Token standard label shown in receive/network UIs (e.g. "ERC-20",
  // "BEP-20"). Display metadata only — does not affect network logic.
  standardLabel: string;
};

export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const BNB_SMART_CHAIN_ID = 56;
export const BASE_CHAIN_ID = 8453;
export const SEPOLIA_CHAIN_ID = 11155111;
// TRON Mainnet's canonical chain id (0x2b6653dc). Used as the single numeric
// routing key for TRON across the app; the human "tron-mainnet" id lives in
// src/chains/tron/tron.config.ts.
export const TRON_MAINNET_CHAIN_ID = 728126428;

export const DEFAULT_CHAINS: ChainConfig[] = [
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    family: "evm",
    name: "Ethereum Mainnet",
    displayName: "Ethereum",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    blockExplorerUrl: "https://etherscan.io",
    isTestnet: false,
    standardLabel: "ERC-20",
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    family: "evm",
    name: "BNB Smart Chain",
    displayName: "BNB Chain",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    rpcUrl: "https://bsc-rpc.publicnode.com",
    blockExplorerUrl: "https://bscscan.com",
    isTestnet: false,
    standardLabel: "BEP-20",
  },
  {
    chainId: BASE_CHAIN_ID,
    family: "evm",
    name: "Base",
    displayName: "Base",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://base-rpc.publicnode.com",
    blockExplorerUrl: "https://basescan.org",
    isTestnet: false,
    standardLabel: "ERC-20",
  },
  {
    chainId: TRON_MAINNET_CHAIN_ID,
    family: "tron",
    name: "TRON",
    displayName: "TRON",
    nativeCurrency: {
      name: "TRON",
      symbol: "TRX",
      decimals: 6,
    },
    rpcUrl: "https://api.trongrid.io",
    blockExplorerUrl: "https://tronscan.org",
    isTestnet: false,
    standardLabel: "TRC-20",
  },
  {
    chainId: SEPOLIA_CHAIN_ID,
    family: "evm",
    name: "Sepolia",
    displayName: "Sepolia",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    blockExplorerUrl: "https://sepolia.etherscan.io",
    isTestnet: true,
    standardLabel: "ERC-20 Testnet",
  },
];

// Token standard label for a chain, with an "EVM" fallback for chains that
// haven't declared one. Display metadata only.
export function getNetworkStandardLabel(chainId: number): string {
  return getChainById(chainId)?.standardLabel ?? "EVM";
}

// Canonical user-facing network name, used everywhere a network is labelled so
// naming stays consistent (e.g. "BNB Chain", "Ethereum"). Falls back to a
// generic "Chain <id>" for unknown chains.
export function getNetworkDisplayName(chainId: number): string {
  return getChainById(chainId)?.displayName ?? `Chain ${chainId}`;
}

// Address/transaction family for a chain. Unknown chains default to "evm" so
// any legacy/custom EVM chain keeps working as before.
export function getChainFamily(chainId: number): ChainFamily {
  return getChainById(chainId)?.family ?? "evm";
}

// True when the chain routes through the TRON adapter instead of EVM plumbing.
export function isTronChainId(chainId: number): boolean {
  return getChainFamily(chainId) === "tron";
}

export function getChainById(chainId: number): ChainConfig | null {
  return DEFAULT_CHAINS.find((chain) => chain.chainId === chainId) ?? null;
}

export function getRequiredChainById(chainId: number): ChainConfig {
  const chain = getChainById(chainId);

  if (!chain) {
    throw new Error(`Unsupported chain id: ${chainId}`);
  }

  return chain;
}