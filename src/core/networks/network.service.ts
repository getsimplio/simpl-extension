// src/core/networks/network.service.ts

import {
  DEFAULT_CHAINS,
  ETHEREUM_MAINNET_CHAIN_ID,
  type ChainConfig,
  type ChainId,
} from "./chain-registry";

export class NetworkService {
  constructor(private readonly chains: ChainConfig[] = DEFAULT_CHAINS) {}

  getChains(): ChainConfig[] {
    return [...this.chains];
  }

  getDefaultChain(): ChainConfig {
    const ethereum = this.getChainById(ETHEREUM_MAINNET_CHAIN_ID);

    if (!ethereum) {
      throw new Error("Default chain not found.");
    }

    return ethereum;
  }

  getChainById(chainId: ChainId): ChainConfig | null {
    return (
      this.chains.find((chain) => {
        return chain.chainId === chainId;
      }) ?? null
    );
  }

  getRequiredChainById(chainId: ChainId): ChainConfig {
    const chain = this.getChainById(chainId);

    if (!chain) {
      throw new Error(`Unsupported chain id: ${chainId}`);
    }

    return chain;
  }

  isSupportedChain(chainId: ChainId): boolean {
    return this.getChainById(chainId) !== null;
  }

  validateChainId(chainId: ChainId): void {
    if (!Number.isInteger(chainId)) {
      throw new Error("Chain id must be an integer.");
    }

    if (chainId <= 0) {
      throw new Error("Chain id must be greater than 0.");
    }

    if (!this.isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain id: ${chainId}`);
    }
  }
}

export const networkService = new NetworkService();