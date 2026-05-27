// src/core/balances/balance.service.ts

import { formatUnits } from "ethers";
import type { EvmAddress } from "../accounts/derivation";
import { networkService } from "../networks/network.service";
import { rpcClient } from "../rpc/rpc.client";

export type NativeBalance = {
  address: EvmAddress;
  chainId: number;
  chainName: string;
  symbol: string;
  decimals: number;
  balanceWei: string;
  formatted: string;
  updatedAt: string;
};

export class BalanceService {
  async getNativeBalance(
    address: EvmAddress,
    chainId: number
  ): Promise<NativeBalance> {
    const chain = networkService.getRequiredChainById(chainId);

    const balanceWei = await rpcClient.getBalance(chain.rpcUrl, address);

    return {
      address,
      chainId: chain.chainId,
      chainName: chain.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      balanceWei: balanceWei.toString(),
      formatted: formatUnits(balanceWei, chain.nativeCurrency.decimals),
      updatedAt: new Date().toISOString(),
    };
  }
}

export const balanceService = new BalanceService();