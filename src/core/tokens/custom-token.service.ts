import { Contract, JsonRpcProvider, getAddress } from "ethers";
import type { EvmAddress } from "../accounts/derivation";
import { networkService } from "../networks/network.service";

const ERC20_METADATA_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;

export type CustomToken = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  createdAt: string;
};

export type CustomTokenPreview = CustomToken & {
  balanceRaw: string;
};

function getCustomTokensStorageKey(chainId: number): string {
  return `simple:customTokens:${chainId}`;
}

function safeReadLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

function normalizeTokenAddress(address: string): `0x${string}` {
  return getAddress(address) as `0x${string}`;
}

export class CustomTokenService {
  getTokensByChainId(chainId: number): CustomToken[] {
    const key = getCustomTokensStorageKey(chainId);
    const raw = safeReadLocalStorage(key);

    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as CustomToken[];

      if (!Array.isArray(parsed)) return [];

      return parsed.filter((token) => {
        return (
          token &&
          token.chainId === chainId &&
          typeof token.address === "string" &&
          typeof token.symbol === "string" &&
          typeof token.name === "string" &&
          typeof token.decimals === "number"
        );
      });
    } catch {
      return [];
    }
  }

  saveTokens(chainId: number, tokens: CustomToken[]): void {
    const key = getCustomTokensStorageKey(chainId);
    safeWriteLocalStorage(key, JSON.stringify(tokens));
  }

  addToken(token: CustomToken): CustomToken[] {
    const normalizedAddress = normalizeTokenAddress(token.address);
    const currentTokens = this.getTokensByChainId(token.chainId);

    const nextToken: CustomToken = {
      ...token,
      address: normalizedAddress,
    };

    const withoutDuplicate = currentTokens.filter(
      (item) => item.address.toLowerCase() !== normalizedAddress.toLowerCase(),
    );

    const nextTokens = [...withoutDuplicate, nextToken];

    this.saveTokens(token.chainId, nextTokens);

    return nextTokens;
  }

  removeToken(input: { chainId: number; address: string }): CustomToken[] {
    const normalizedAddress = normalizeTokenAddress(input.address);
    const currentTokens = this.getTokensByChainId(input.chainId);

    const nextTokens = currentTokens.filter(
      (token) => token.address.toLowerCase() !== normalizedAddress.toLowerCase(),
    );

    this.saveTokens(input.chainId, nextTokens);

    return nextTokens;
  }

  async loadTokenPreview(input: {
    chainId: number;
    tokenAddress: string;
    ownerAddress: EvmAddress;
  }): Promise<CustomTokenPreview> {
    const chain = networkService.getRequiredChainById(input.chainId);
    const tokenAddress = normalizeTokenAddress(input.tokenAddress);

    const provider = new JsonRpcProvider(chain.rpcUrl, chain.chainId);
    const contract = new Contract(tokenAddress, ERC20_METADATA_ABI, provider);

    const [name, symbol, decimals, balanceRaw] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.balanceOf(input.ownerAddress),
    ]);

    return {
      chainId: input.chainId,
      address: tokenAddress,
      name: String(name),
      symbol: String(symbol),
      decimals: Number(decimals),
      balanceRaw: BigInt(balanceRaw).toString(),
      createdAt: new Date().toISOString(),
    };
  }
}

export const customTokenService = new CustomTokenService();
