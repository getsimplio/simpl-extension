import { Contract, JsonRpcProvider, getAddress } from "ethers";
import type { EvmAddress } from "../accounts/derivation";
import { networkService } from "../networks/network.service";
import { isSolanaChainId } from "../networks/chain-registry";
import { isValidSolanaAddress } from "../../chains/solana/solana.address";

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
  logoURI?: string;
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

// Chain-aware normalization. Solana mints are base58 + case-sensitive, so they
// are validated and kept verbatim; EVM keeps checksum normalization.
function normalizeTokenAddressForChain(
  chainId: number,
  address: string,
): `0x${string}` {
  const trimmed = address.trim();

  if (isSolanaChainId(chainId)) {
    if (!isValidSolanaAddress(trimmed)) {
      throw new Error("Invalid Solana token mint address.");
    }
    return trimmed as `0x${string}`;
  }

  return normalizeTokenAddress(trimmed);
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
    const normalizedAddress = normalizeTokenAddressForChain(
      token.chainId,
      token.address,
    );
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

  // Best-effort metadata patch for an ALREADY-imported token. Used to backfill
  // logo/name/symbol resolved after import (e.g. tokens saved before logo support
  // or whose metadata wasn't reachable at import time). Only the fields the caller
  // passes are written, and only when they differ; never creates a new entry, so
  // a no-op when the mint isn't in the store. Solana mints are matched verbatim
  // (case-sensitive); EVM addresses are matched case-insensitively.
  updateTokenMetadata(input: {
    chainId: number;
    address: string;
    name?: string;
    symbol?: string;
    logoURI?: string;
  }): void {
    const current = this.getTokensByChainId(input.chainId);
    const solana = isSolanaChainId(input.chainId);
    const target = input.address.trim();
    const matches = (addr: string): boolean =>
      solana ? addr === target : addr.toLowerCase() === target.toLowerCase();

    let changed = false;
    const next = current.map((token) => {
      if (!matches(token.address)) return token;
      const patched: CustomToken = { ...token };
      if (input.logoURI && patched.logoURI !== input.logoURI) {
        patched.logoURI = input.logoURI;
        changed = true;
      }
      if (input.name && patched.name !== input.name) {
        patched.name = input.name;
        changed = true;
      }
      if (input.symbol && patched.symbol !== input.symbol) {
        patched.symbol = input.symbol;
        changed = true;
      }
      return patched;
    });

    if (changed) this.saveTokens(input.chainId, next);
  }

  removeToken(input: { chainId: number; address: string }): CustomToken[] {
    const normalizedAddress = normalizeTokenAddressForChain(
      input.chainId,
      input.address,
    );
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
