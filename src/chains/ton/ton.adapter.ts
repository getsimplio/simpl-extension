// src/chains/ton/ton.adapter.ts
//
// The single entry point the wallet service uses for TON. It adapts the native
// Toncoin balance and trusted Jetton balances into the same WalletAssetBalance
// shape the rest of the wallet already speaks, so HomePage's asset list, asset
// detail, total balance and the Receive screen work largely unchanged.
//
// Scope: read-only native balance + trusted Jettons + receive, plus NATIVE TON
// send. Jetton send is intentionally out of scope (refused with a coded error).

import { type TonChainConfig } from "./ton.config";
import { tonToNano } from "./ton.format";
import { getTonBalance, getTonBalanceNano } from "./ton.balance";
import { getTonJettonBalances } from "./ton.jettons";
import {
  sendNativeTon,
  getTonTransactionStatus,
  waitForTonTransaction,
} from "./ton.transactions";
import { tonErrorFor } from "./ton.errors";
import { TON_NATIVE_TOKEN } from "./ton.tokens";
import type { TonJettonBalance } from "./ton.types";
import type { KeyPair } from "@ton/crypto";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";

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
  // Display amount (e.g. "0.25").
  amount: string;
  recipient: string;
  // Sender wallet address (user-friendly) for the pre-flight + explorer link.
  fromAddress: string;
  // Signing material — supplied by the wallet service only.
  keyPair: KeyPair;
};

// Send a TON asset. NATIVE Toncoin is fully implemented; Jetton transfers are
// intentionally refused with a clean coded error (Jetton send is out of scope
// this PR). Amount parsing (tonToNano) validates the amount and decimals; the
// transfer body handles balance/fee/seqno/build/sign/broadcast.
export async function sendTonAsset(
  input: SendTonInput,
): Promise<TonAdapterSendResult> {
  const { config, asset, amount, recipient, fromAddress, keyPair } = input;

  if (asset.type !== "native") {
    // Jetton send is not wired — see ton.tokens.ts TON_SEND_UNSUPPORTED.
    throw tonErrorFor("TON_SEND_UNSUPPORTED");
  }

  const amountNano = tonToNano(amount);

  const result = await sendNativeTon({
    config,
    keyPair,
    fromAddress,
    toAddress: recipient,
    amountNano,
  });

  return {
    hash: result.hash,
    chainId: config.chainId,
    assetSymbol: config.symbol,
    amount,
    toAddress: recipient,
    explorerUrl: result.explorerUrl,
  };
}

// Map a sent TON message's status onto the wallet's shared activity statuses.
// `account` is the sender's user-friendly address, required by the proxy to
// locate the message on-chain.
export async function getTonActivityStatus(
  config: TonChainConfig,
  account: string,
  hash: string,
): Promise<TransactionHistoryStatus> {
  return getTonTransactionStatus(config, account, hash);
}

// Wait for a sent TON message to confirm (or fail). Throws on timeout.
export async function waitForTonActivity(
  config: TonChainConfig,
  account: string,
  hash: string,
  timeoutMs: number,
): Promise<"confirmed" | "failed"> {
  return waitForTonTransaction(config, account, hash, timeoutMs);
}
