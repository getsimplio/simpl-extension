export type DiscoveredAssetType = "native" | "erc20";

export type DiscoveredTokenAsset = {
  id: string;
  type: DiscoveredAssetType;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: string | null;
  balanceRaw: string;
  formatted: string;
  usdPrice: string | null;
  usdValue: string | null;
  logoUrl: string | null;
  isSpam: boolean;
  isVerified: boolean;
  isTransferable: boolean;
};

export type AssetDiscoveryResponse = {
  assets: DiscoveredTokenAsset[];
  updatedAt: string;
  source: string;
};
