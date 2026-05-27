// src/core/networks/chain-registry.ts

export type ChainId = number;

export type ChainConfig = {
  chainId: ChainId;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  blockExplorerUrl: string;
  isTestnet: boolean;
};

export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const BNB_SMART_CHAIN_ID = 56;
export const BASE_CHAIN_ID = 8453;
export const SEPOLIA_CHAIN_ID = 11155111;

export const DEFAULT_CHAINS: ChainConfig[] = [
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    name: "Ethereum Mainnet",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    blockExplorerUrl: "https://etherscan.io",
    isTestnet: false,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    name: "BNB Smart Chain",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    rpcUrl: "https://bsc-rpc.publicnode.com",
    blockExplorerUrl: "https://bscscan.com",
    isTestnet: false,
  },
  {
    chainId: BASE_CHAIN_ID,
    name: "Base",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://base-rpc.publicnode.com",
    blockExplorerUrl: "https://basescan.org",
    isTestnet: false,
  },
  {
    chainId: SEPOLIA_CHAIN_ID,
    name: "Sepolia",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    blockExplorerUrl: "https://sepolia.etherscan.io",
    isTestnet: true,
  },
];

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