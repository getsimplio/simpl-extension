// src/chains/ton/ton.adapter.ts
//
// The single entry point the wallet service uses for TON. It adapts the native
// Toncoin balance and trusted Jetton balances into the same WalletAssetBalance
// shape the rest of the wallet already speaks, so HomePage's asset list, asset
// detail, total balance and the Receive screen work largely unchanged.
//
// MVP scope: read-only native balance + trusted Jettons + receive. Sending
// (native or jetton) is NOT wired here yet — see sendTonAsset below for the
// architectural send backstop.

import {
  getTonAddressExplorerUrl,
  type TonChainConfig,
} from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { getTonBalance, getTonBalanceNano } from "./ton.balance";
import { getTonJettonBalances } from "./ton.jettons";
import { tonErrorFor } from "./ton.errors";
import { TON_NATIVE_TOKEN } from "./ton.tokens";
import type { TonJettonBalance } from "./ton.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";

const isDev = Boolean((import.meta.env as { DEV?: boolean } | undefined)?.DEV);

function nativeAssetId(config: TonChainConfig): string {
  return `native:${config.chainId}`;
}

function jettonAssetId(config: TonChainConfig, master: string): string {
  return `jetton:${config.chainId}:${master}`;
}

function toJettonAsset(
  config: TonChainConfig,
  jetton: TonJettonBalance,
  updatedAt: string,
): WalletAssetBalance {
  return {
    id: jettonAssetId(config, jetton.master),
    type: "jetton",
    chainId: config.chainId,
    chainName: config.name,
    name: jetton.name,
    symbol: jetton.symbol,
    decimals: jetton.decimals,
    // Canonical user-friendly master address — used for price identity (gateway
    // is keyed by chainId + address) and the explorer link.
    contractAddress: jetton.master,
    balanceRaw: jetton.rawBalance.toString(),
    formatted: jetton.formatted,
    updatedAt,
    isTransferable: true,
    visible: true,
    // Live USD spot price from the read API, when available; HomePage prefers
    // this numeric price over a gateway lookup, and degrades to "No price"
    // cleanly when it's null.
    usdPrice: jetton.usdPrice,
    usdValue: null,
    logoUrl: null,
    isSpam: false,
    isVerified: true,
    source: "registry",
  };
}

// Build the TON portfolio: native Toncoin (always present, even at zero balance)
// followed by trusted Jetton balances. Jetton discovery is best-effort — a
// failure there degrades to native-only rather than failing the whole refresh,
// so the wallet always shows TON even if the jetton API is down.
export async function getTonPortfolio(
  config: TonChainConfig,
  address: string,
): Promise<WalletAssetBalance[]> {
  const updatedAt = new Date().toISOString();
  const balance = await getTonBalance(address, config);

  const nativeAsset: WalletAssetBalance = {
    id: nativeAssetId(config),
    type: "native",
    chainId: config.chainId,
    chainName: config.name,
    name: TON_NATIVE_TOKEN.name,
    symbol: config.symbol,
    decimals: config.decimals,
    contractAddress: null,
    balanceRaw: balance.raw.toString(),
    formatted: balance.formatted,
    updatedAt,
    isTransferable: true,
    visible: true,
    usdPrice: null,
    usdValue: null,
    logoUrl: null,
    isSpam: false,
    isVerified: true,
    source: "native",
  };

  let jettonAssets: WalletAssetBalance[] = [];
  try {
    const jettons = await getTonJettonBalances(address, config);
    jettonAssets = jettons.map((jetton) =>
      toJettonAsset(config, jetton, updatedAt),
    );
  } catch (error) {
    // Non-fatal: keep showing native TON if jetton discovery fails.
    if (isDev) console.debug("[TON] jetton discovery failed:", error);
  }

  return [nativeAsset, ...jettonAssets];
}

// Native Toncoin balance in nanoton, for the single-balance surfaces.
export async function getTonNativeBalanceNano(
  config: TonChainConfig,
  address: string,
): Promise<bigint> {
  return getTonBalanceNano(address, config);
}

export type TonAdapterSendResult = {
  hash: string;
  chainId: number;
  assetSymbol: string;
  amount: string;
  toAddress: string;
  explorerUrl: string | null;
};

export type SendTonInput = {
  config: TonChainConfig;
  asset: WalletAssetBalance;
  amount: string;
  recipient: string;
};

// Architectural send entry point. Sending TON is intentionally NOT implemented
// in this MVP (a half-working transfer that risks user funds is worse than a
// clean, explicit error). Recipient validation is wired so a future send only
// needs the build/sign/broadcast body. Throws a coded TonError today.
export async function sendTonAsset(
  input: SendTonInput,
): Promise<TonAdapterSendResult> {
  if (!isValidTonAddress(input.recipient)) {
    throw tonErrorFor("TON_INVALID_ADDRESS");
  }

  // Resolve the explorer base now so the future implementation has it ready.
  void getTonAddressExplorerUrl(input.config, input.recipient);

  throw tonErrorFor("TON_SEND_UNSUPPORTED");
}
