import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import type { EvmAddress } from "../accounts/derivation";
import { balanceService } from "../balances/balance.service";
import { networkService } from "../networks/network.service";
import { setCachedTokenLogo } from "../../utils/token-logo-resolver";
import { assetDiscoveryService } from "./asset-discovery.service";
import { customTokenService, type CustomToken } from "./custom-token.service";
import {
  getRegisteredTokensByChainId,
  type RegisteredToken,
} from "./token-registry";

const ERC20_BALANCE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
] as const;

// "trc20" is the TRON token standard, routed through the TRON adapter; "spl" is
// the Solana token standard, routed through the Solana adapter; "jetton" is the
// TON fungible-token standard, routed through the TON adapter. EVM flows only
// ever produce "native" | "erc20".
export type WalletAssetType = "native" | "erc20" | "trc20" | "spl" | "jetton";

export type WalletAssetBalance = {
  id: string;
  type: WalletAssetType;
  chainId: number;
  chainName: string;
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: string | null;
  balanceRaw: string;
  formatted: string;
  updatedAt: string;
  isTransferable: boolean;
  visible: boolean;
  // Usually a string|null from the discovery gateway, but adapters that already
  // resolved a numeric spot price (e.g. TON jettons via the read API) may set a
  // number directly — HomePage prefers a numeric price/value when present.
  usdPrice?: number | string | null;
  usdValue?: number | string | null;
  logoUrl?: string | null;
  isSpam?: boolean;
  isVerified?: boolean;
  source?: "native" | "registry" | "discovery" | "custom" | "watched";
};

export type WalletPortfolio = {
  address: EvmAddress;
  chainId: number;
  chainName: string;
  assets: WalletAssetBalance[];
  updatedAt: string;
};

type BalanceToken = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  alwaysShow?: boolean;
  source: "registry" | "custom";
  logoURI?: string | null;
};

function isPositiveRawBalance(rawBalance: string): boolean {
  try {
    return BigInt(rawBalance) > 0n;
  } catch {
    return false;
  }
}

function getAssetDedupeKey(asset: WalletAssetBalance): string {
  if (asset.type === "native") {
    return `native:${asset.chainId}`;
  }

  return `erc20:${asset.chainId}:${asset.contractAddress?.toLowerCase()}`;
}

function dedupeAssets(assets: WalletAssetBalance[]): WalletAssetBalance[] {
  const map = new Map<string, WalletAssetBalance>();

  assets.forEach((asset) => {
    map.set(getAssetDedupeKey(asset), asset);
  });

  return Array.from(map.values());
}

function mapRegisteredToken(token: RegisteredToken): BalanceToken {
  return {
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    alwaysShow: token.alwaysShow,
    source: "registry",
  };
}

function mapCustomToken(token: CustomToken): BalanceToken {
  return {
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    alwaysShow: true,
    source: "custom",
    logoURI: token.logoURI ?? null,
  };
}

export class TokenBalanceService {
  async getPortfolio(
    address: EvmAddress,
    chainId: number,
  ): Promise<WalletPortfolio> {
    const chain = networkService.getRequiredChainById(chainId);
    const updatedAt = new Date().toISOString();

    const nativeAsset = await this.getNativeAsset(address, chainId);

    const [registryAndCustomTokens, discoveredTokens] = await Promise.all([
      this.getRegistryAndCustomTokenBalances(address, chainId),
      this.getDiscoveredTokenBalances(address, chainId),
    ]);

    const assets = dedupeAssets([
      nativeAsset,
      ...registryAndCustomTokens,
      ...discoveredTokens,
    ]);

    return {
      address,
      chainId: chain.chainId,
      chainName: chain.name,
      assets,
      updatedAt,
    };
  }

  private async getNativeAsset(
    address: EvmAddress,
    chainId: number,
  ): Promise<WalletAssetBalance> {
    const chain = networkService.getRequiredChainById(chainId);
    const nativeBalance = await balanceService.getNativeBalance(address, chainId);

    return {
      id: `native:${chain.chainId}`,
      type: "native",
      chainId: chain.chainId,
      chainName: chain.name,
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      contractAddress: null,
      balanceRaw: nativeBalance.balanceWei,
      formatted: nativeBalance.formatted,
      updatedAt: nativeBalance.updatedAt,
      isTransferable: true,
      visible: true,
      usdPrice: null,
      usdValue: null,
      logoUrl: null,
      isSpam: false,
      isVerified: true,
      source: "native",
    };
  }

  private async getDiscoveredTokenBalances(
    address: EvmAddress,
    chainId: number,
  ): Promise<WalletAssetBalance[]> {
    const chain = networkService.getRequiredChainById(chainId);

    try {
      const discoveredAssets = await assetDiscoveryService.getDiscoveredTokens({
        address,
        chainId,
      });

      // Persist any logo URLs returned by discovery so they survive into custom-token renders
      for (const asset of discoveredAssets) {
        if (asset.contractAddress && asset.logoUrl) {
          setCachedTokenLogo(asset.chainId, asset.contractAddress, asset.logoUrl);
        }
      }

      return discoveredAssets
        .filter((asset) => asset.type === "erc20")
        .filter((asset) => asset.balanceRaw !== "0")
        .filter((asset) => !asset.isSpam)
        .map((asset) => ({
          id: asset.id,
          type: "erc20",
          chainId: asset.chainId,
          chainName: chain.name,
          name: asset.name,
          symbol: asset.symbol,
          decimals: asset.decimals,
          contractAddress: asset.contractAddress,
          balanceRaw: asset.balanceRaw,
          formatted: asset.formatted,
          updatedAt: new Date().toISOString(),
          isTransferable: asset.isTransferable,
          visible: true,
          usdPrice: asset.usdPrice,
          usdValue: asset.usdValue,
          logoUrl: asset.logoUrl,
          isSpam: asset.isSpam,
          isVerified: asset.isVerified,
          source: "discovery",
        }));
    } catch (error) {
      console.debug("Asset discovery failed:", error);
      return [];
    }
  }

  private async getRegistryAndCustomTokenBalances(
    address: EvmAddress,
    chainId: number,
  ): Promise<WalletAssetBalance[]> {
    const chain = networkService.getRequiredChainById(chainId);

    const registryTokens = getRegisteredTokensByChainId(chainId).map(
      mapRegisteredToken,
    );

    const customTokens = customTokenService
      .getTokensByChainId(chainId)
      .map(mapCustomToken);

    const tokens = [...registryTokens, ...customTokens];

    if (tokens.length === 0) {
      return [];
    }

    const provider = new JsonRpcProvider(chain.rpcUrl, chain.chainId);

    const settledResults = await Promise.allSettled(
      tokens.map((token) => this.getTokenBalance(provider, token, address)),
    );

    // One failed token never drops the rest: allSettled isolates each call and
    // we keep every fulfilled balance. Failures are logged with their token
    // address + chainId for diagnostics (no secrets).
    return settledResults.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return [result.value];
      }

      const token = tokens[index];
      console.debug("[balances] token balance failed", {
        chainId,
        token: token?.address,
        symbol: token?.symbol,
        reason: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      });
      return [];
    });
  }

  private async getTokenBalance(
    provider: JsonRpcProvider,
    token: BalanceToken,
    ownerAddress: EvmAddress,
  ): Promise<WalletAssetBalance> {
    const chain = networkService.getRequiredChainById(token.chainId);
    const contract = new Contract(token.address, ERC20_BALANCE_ABI, provider);

    const rawBalance = (await contract.balanceOf(ownerAddress)) as bigint;
    const rawBalanceString = rawBalance.toString();

    return {
      id: `erc20:${token.chainId}:${token.address.toLowerCase()}`,
      type: "erc20",
      chainId: token.chainId,
      chainName: chain.name,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      contractAddress: token.address,
      balanceRaw: rawBalanceString,
      formatted: formatUnits(rawBalance, token.decimals),
      updatedAt: new Date().toISOString(),
      isTransferable: true,
      visible: token.alwaysShow === true || isPositiveRawBalance(rawBalanceString),
      usdPrice: null,
      usdValue: null,
      logoUrl: token.logoURI ?? null,
      isSpam: false,
      isVerified: token.source === "registry",
      source: token.source,
    };
  }
}

export const tokenBalanceService = new TokenBalanceService();
