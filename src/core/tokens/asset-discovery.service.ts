import type { EvmAddress } from "../accounts/derivation";
import type {
  AssetDiscoveryResponse,
  DiscoveredTokenAsset,
} from "./asset-discovery.types";

function getAssetApiUrl(): string | null {
  const env = import.meta.env as {
    VITE_ASSET_API_URL?: string;
  };

  if (!env.VITE_ASSET_API_URL) {
    return null;
  }

  return env.VITE_ASSET_API_URL.replace(/\/$/, "");
}

export class AssetDiscoveryService {
  async getDiscoveredTokens(input: {
    address: EvmAddress;
    chainId: number;
  }): Promise<DiscoveredTokenAsset[]> {
    const baseUrl = getAssetApiUrl();

    /**
     * If backend /assets is not configured yet,
     * silently fall back to registry/custom tokens.
     */
    if (!baseUrl) {
      return [];
    }

    const url = new URL(`${baseUrl}/assets`);

    url.searchParams.set("address", input.address);
    url.searchParams.set("chainId", String(input.chainId));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Asset discovery failed: ${message}`);
    }

    const data = (await response.json()) as AssetDiscoveryResponse;

    if (!Array.isArray(data.assets)) {
      throw new Error("Invalid asset discovery response.");
    }

    return data.assets;
  }
}

export const assetDiscoveryService = new AssetDiscoveryService();
