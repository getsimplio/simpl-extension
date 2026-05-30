// src/core/tokens/token-registry.ts

import {
  Contract,
  JsonRpcProvider,
  decodeBytes32String,
  formatUnits,
  getAddress,
  isAddress,
} from "ethers";
import type { EvmAddress } from "../accounts/derivation";
import {
  BASE_CHAIN_ID,
  BNB_SMART_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "../networks/chain-registry";
import { networkService } from "../networks/network.service";

export type RegisteredToken = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  alwaysShow?: boolean;
};

export type CustomToken = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  createdAt: string;
};

export type TokenPreview = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balanceFormatted: string;
  createdAt: string;
};

export const REGISTERED_TOKENS: RegisteredToken[] = [
  // Ethereum Mainnet

  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    alwaysShow: true,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    alwaysShow: true,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    symbol: "LINK",
    name: "Chainlink",
    decimals: 18,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    symbol: "UNI",
    name: "Uniswap",
    decimals: 18,
  },
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    symbol: "AAVE",
    name: "Aave",
    decimals: 18,
  },

  // BNB Smart Chain / BEP-20

  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0x55d398326f99059fF775485246999027B3197955",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    alwaysShow: true,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 18,
    alwaysShow: true,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    symbol: "WBNB",
    name: "Wrapped BNB",
    decimals: 18,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
    symbol: "DAI",
    name: "Dai Token",
    decimals: 18,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    symbol: "CAKE",
    name: "PancakeSwap Token",
    decimals: 18,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    symbol: "BTCB",
    name: "Binance-Peg BTCB Token",
    decimals: 18,
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    symbol: "ETH",
    name: "Binance-Peg Ethereum Token",
    decimals: 18,
  },

  // Base

  {
    chainId: BASE_CHAIN_ID,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    alwaysShow: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: "0x4D13a9b2a5adA3B52F36E4CcdB91023F3d05EC6e",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    alwaysShow: true,
  },

  // Sepolia test tokens can be added manually via + Token.
  // We keep Sepolia registry empty by default.
];

const ERC20_STRING_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
];

const ERC20_BYTES32_ABI = [
  "function name() view returns (bytes32)",
  "function symbol() view returns (bytes32)",
];

export function getRegisteredTokensByChainId(chainId: number): RegisteredToken[] {
  if (chainId === SEPOLIA_CHAIN_ID) {
    return [];
  }

  return REGISTERED_TOKENS.filter((token) => token.chainId === chainId);
}

function getCustomTokensStorageKey(chainId: number): string {
  return `simple:customTokens:${chainId}`;
}

function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage is optional for custom tokens.
  }
}

function normalizeTokenAddress(address: string): `0x${string}` {
  const trimmedAddress = address.trim();

  if (!isAddress(trimmedAddress)) {
    throw new Error("Invalid token contract address.");
  }

  return getAddress(trimmedAddress) as `0x${string}`;
}

function isCustomToken(value: unknown): value is CustomToken {
  if (!value || typeof value !== "object") return false;

  const token = value as Partial<CustomToken>;

  return (
    typeof token.chainId === "number" &&
    typeof token.address === "string" &&
    typeof token.symbol === "string" &&
    typeof token.name === "string" &&
    typeof token.decimals === "number"
  );
}

function decodeBytes32Value(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;

    const decoded = decodeBytes32String(value).trim();

    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

async function readStringMetadata(
  contract: Contract,
  methodName: "name" | "symbol",
): Promise<string | null> {
  try {
    const value = await contract[methodName]();

    if (typeof value !== "string") return null;

    const trimmedValue = value.trim();

    return trimmedValue.length > 0 ? trimmedValue : null;
  } catch {
    return null;
  }
}

async function readBytes32Metadata(
  contract: Contract,
  methodName: "name" | "symbol",
): Promise<string | null> {
  try {
    const value = await contract[methodName]();

    return decodeBytes32Value(value);
  } catch {
    return null;
  }
}

async function readTokenSymbol(
  stringContract: Contract,
  bytes32Contract: Contract,
): Promise<string | null> {
  const stringSymbol = await readStringMetadata(stringContract, "symbol");

  if (stringSymbol) return stringSymbol;

  return readBytes32Metadata(bytes32Contract, "symbol");
}

async function readTokenName(
  stringContract: Contract,
  bytes32Contract: Contract,
): Promise<string | null> {
  const stringName = await readStringMetadata(stringContract, "name");

  if (stringName) return stringName;

  return readBytes32Metadata(bytes32Contract, "name");
}

export class TokenRegistryService {
  getTokensByChainId(chainId: number): CustomToken[] {
    const raw = readLocalStorage(getCustomTokensStorageKey(chainId));

    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(isCustomToken)
        .filter((token) => token.chainId === chainId)
        .map((token) => ({
          ...token,
          address: normalizeTokenAddress(token.address),
        }));
    } catch {
      return [];
    }
  }

  saveTokens(chainId: number, tokens: CustomToken[]): void {
    writeLocalStorage(getCustomTokensStorageKey(chainId), JSON.stringify(tokens));
  }

  addToken(token: CustomToken): CustomToken[] {
    const address = normalizeTokenAddress(token.address);
    const currentTokens = this.getTokensByChainId(token.chainId);

    const nextToken: CustomToken = {
      ...token,
      address,
    };

    const nextTokens = [
      ...currentTokens.filter((item) => {
        return item.address.toLowerCase() !== address.toLowerCase();
      }),
      nextToken,
    ];

    this.saveTokens(token.chainId, nextTokens);

    return nextTokens;
  }

  removeToken(input: { chainId: number; address: string }): CustomToken[] {
    const address = normalizeTokenAddress(input.address);

    const nextTokens = this.getTokensByChainId(input.chainId).filter((token) => {
      return token.address.toLowerCase() !== address.toLowerCase();
    });

    this.saveTokens(input.chainId, nextTokens);

    return nextTokens;
  }

  async loadTokenPreview(input: {
    chainId: number;
    tokenAddress: string;
    ownerAddress: EvmAddress;
  }): Promise<TokenPreview> {
    const chain = networkService.getRequiredChainById(input.chainId);
    const tokenAddress = normalizeTokenAddress(input.tokenAddress);

    const provider = new JsonRpcProvider(chain.rpcUrl, chain.chainId);

    const contractCode = await provider.getCode(tokenAddress);

    if (contractCode === "0x") {
      throw new Error(
        `No contract at this address on ${chain.name}. Make sure you're on the right network and the address is correct.`,
      );
    }

    const stringContract = new Contract(
      tokenAddress,
      ERC20_STRING_ABI,
      provider,
    );

    const bytes32Contract = new Contract(
      tokenAddress,
      ERC20_BYTES32_ABI,
      provider,
    );

    let decimals: number;

    try {
      decimals = Number(await stringContract.decimals());
    } catch {
      throw new Error(
        "Contract found, but token metadata could not be read. (decimals() missing — may not be ERC-20)",
      );
    }

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error("Contract found, but decimals value is invalid.");
    }

    const symbol = await readTokenSymbol(stringContract, bytes32Contract);

    if (!symbol) {
      throw new Error(
        "Contract found, but token metadata could not be read. (symbol() missing)",
      );
    }

    const name = (await readTokenName(stringContract, bytes32Contract)) ?? symbol;

    let balanceRaw: bigint;

    try {
      balanceRaw = BigInt(await stringContract.balanceOf(input.ownerAddress));
    } catch {
      throw new Error(
        "Contract found, but token metadata could not be read. (balanceOf() missing — may not be ERC-20)",
      );
    }

    return {
      chainId: chain.chainId,
      address: tokenAddress,
      symbol,
      name,
      decimals,
      balanceRaw: balanceRaw.toString(),
      balanceFormatted: formatUnits(balanceRaw, decimals),
      createdAt: new Date().toISOString(),
    };
  }
}

export const tokenRegistryService = new TokenRegistryService();