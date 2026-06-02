// src/chains/tron/tron.adapter.ts
//
// The single entry point the wallet service uses for TRON. It adapts TRON
// balances / sends / status into the same shapes the rest of the wallet already
// speaks (WalletAssetBalance, the send result, submitted/confirmed/failed
// statuses) so HomePage, SendPage and history work unchanged.

import { TRON_MAINNET_CHAIN_ID } from "../../core/networks/chain-registry";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";
import {
  TRON_MAINNET,
  getTronTransactionExplorerUrl,
  TRC20_DEFAULT_FEE_LIMIT_SUN,
} from "./tron.config";
import { TRON_TOKENS, type TronToken } from "./tron.tokens";
import { getTrc20Balance, getTrxBalance } from "./tron.balance";
import { fromBaseUnits, toBaseUnits, trxToSun } from "./tron.format";
import {
  getTronTransactionStatus,
  sendTrc20,
  sendTrx,
} from "./tron.transactions";
import { isValidTronAddress } from "./tron.address";

export type TronSendResult = {
  hash: string;
  chainId: number;
  assetSymbol: string;
  amount: string;
  toAddress: string;
  explorerUrl: string | null;
};

function tronAssetId(token: TronToken): string {
  if (token.type === "native") {
    return `native:${TRON_MAINNET_CHAIN_ID}`;
  }

  return `trc20:${TRON_MAINNET_CHAIN_ID}:${token.contractAddress?.toLowerCase()}`;
}

async function getTokenBaseBalance(
  token: TronToken,
  ownerAddress: string,
): Promise<bigint> {
  if (token.type === "native") {
    return getTrxBalance(ownerAddress);
  }

  return getTrc20Balance(
    ownerAddress,
    token.contractAddress as string,
    token.decimals,
  );
}

function toAssetBalance(
  token: TronToken,
  baseUnits: bigint,
  updatedAt: string,
): WalletAssetBalance {
  return {
    id: tronAssetId(token),
    type: token.type === "native" ? "native" : "trc20",
    chainId: TRON_MAINNET_CHAIN_ID,
    chainName: TRON_MAINNET.name,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    contractAddress: token.contractAddress,
    balanceRaw: baseUnits.toString(),
    formatted: fromBaseUnits(baseUnits, token.decimals),
    updatedAt,
    isTransferable: true,
    // TRX and USDT are core TRON assets — always shown, like EVM stablecoins.
    visible: true,
    usdPrice: null,
    usdValue: null,
    logoUrl: null,
    isSpam: false,
    isVerified: true,
    source: token.type === "native" ? "native" : "registry",
  };
}

// Build the TRON portfolio (TRX + USDT TRC-20) for an address. A failed balance
// read falls back to a zero balance so one slow token never blanks the screen.
export async function getTronPortfolio(
  ownerAddress: string,
): Promise<WalletAssetBalance[]> {
  const updatedAt = new Date().toISOString();

  const results = await Promise.all(
    TRON_TOKENS.map(async (token) => {
      try {
        const baseUnits = await getTokenBaseBalance(token, ownerAddress);
        return toAssetBalance(token, baseUnits, updatedAt);
      } catch (error) {
        console.debug("TRON balance read failed:", token.symbol, error);
        return toAssetBalance(token, 0n, updatedAt);
      }
    }),
  );

  return results;
}

// Send a TRON asset (TRX or USDT TRC-20). Validation, amount conversion and the
// signed broadcast happen here; the private key is supplied by the wallet
// service and never reaches the UI.
export async function sendTronAsset(input: {
  asset: WalletAssetBalance;
  privateKey: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
}): Promise<TronSendResult> {
  const { asset, privateKey, fromAddress, toAddress, amount } = input;

  if (!isValidTronAddress(toAddress)) {
    throw new Error("Invalid recipient address.");
  }

  if (asset.type === "native") {
    const amountSun = trxToSun(amount);
    const balanceSun = await getTrxBalance(fromAddress);

    if (balanceSun < amountSun) {
      throw new Error("Insufficient TRX balance.");
    }

    const { txId } = await sendTrx({
      privateKey,
      fromAddress,
      toAddress,
      amountSun,
    });

    return {
      hash: txId,
      chainId: TRON_MAINNET_CHAIN_ID,
      assetSymbol: asset.symbol,
      amount,
      toAddress,
      explorerUrl: getTronTransactionExplorerUrl(txId),
    };
  }

  if (asset.type === "trc20") {
    if (!asset.contractAddress) {
      throw new Error("Token contract address is missing.");
    }

    const amountBaseUnits = toBaseUnits(amount, asset.decimals);
    const tokenBalance = await getTrc20Balance(
      fromAddress,
      asset.contractAddress,
      asset.decimals,
    );

    if (tokenBalance < amountBaseUnits) {
      throw new Error(`Insufficient ${asset.symbol} balance.`);
    }

    // TRC-20 transfers are paid in TRX (energy/bandwidth). Block early with a
    // clear message when the account has no TRX at all.
    const trxBalance = await getTrxBalance(fromAddress);
    if (trxBalance <= 0n) {
      throw new Error(
        "You need TRX to pay the network fee for this transfer. Keep some TRX in your wallet.",
      );
    }

    const { txId } = await sendTrc20({
      privateKey,
      fromAddress,
      toAddress,
      contractAddress: asset.contractAddress,
      amountBaseUnits,
      feeLimitSun: TRC20_DEFAULT_FEE_LIMIT_SUN,
    });

    return {
      hash: txId,
      chainId: TRON_MAINNET_CHAIN_ID,
      assetSymbol: asset.symbol,
      amount,
      toAddress,
      explorerUrl: getTronTransactionExplorerUrl(txId),
    };
  }

  throw new Error("Unsupported TRON asset type.");
}

// Map TRON polling status onto the wallet's shared activity statuses.
export async function getTronActivityStatus(
  txId: string,
): Promise<TransactionHistoryStatus> {
  const status = await getTronTransactionStatus(txId);

  if (status === "confirmed") return "confirmed";
  if (status === "failed") return "failed";

  return "submitted";
}
