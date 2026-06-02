// src/chains/tron/tron.tokens.ts
//
// TRON token registry. Mirrors the shape the EVM token registry exposes (symbol
// / name / decimals) but uses TRON address types and a "trc20" standard. Token
// balances are never shown in raw sun/base units — always format through
// tron.format.ts.

import { TRX_DECIMALS } from "./tron.config";

export type TronTokenType = "native" | "trc20";

export type TronToken = {
  type: TronTokenType;
  symbol: string;
  name: string;
  decimals: number;
  // Base58 TRC-20 contract address; null for the native TRX asset.
  contractAddress: string | null;
};

export const TRX_TOKEN: TronToken = {
  type: "native",
  symbol: "TRX",
  name: "TRON",
  decimals: TRX_DECIMALS,
  contractAddress: null,
};

// USDT TRC-20 (Tether USD) on TRON Mainnet.
export const USDT_TRC20_TOKEN: TronToken = {
  type: "trc20",
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
};

// Tokens shown for any TRON account, in display order (native first).
export const TRON_TOKENS: TronToken[] = [TRX_TOKEN, USDT_TRC20_TOKEN];

export const TRON_TRC20_TOKENS: TronToken[] = TRON_TOKENS.filter(
  (token): token is TronToken & { contractAddress: string } =>
    token.type === "trc20" && token.contractAddress !== null,
);
