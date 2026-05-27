import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  keccak256,
  isAddress,
  parseUnits,
} from "ethers";
import type { EvmAddress } from "../accounts/derivation";
import { networkService } from "../networks/network.service";
import type { WalletAssetBalance } from "../tokens/token-balance.service";

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

export type SendAssetInput = {
  asset: WalletAssetBalance;
  privateKey: string;
  fromAddress: EvmAddress;
  toAddress: string;
  amount: string;
  chainId: number;
};

export type SendAssetResult = {
  hash: string;
  chainId: number;
  assetSymbol: string;
  amount: string;
  toAddress: string;
  explorerUrl: string | null;
};

export type PreparedTransactionRequest = {
  to: string;
  data?: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
};

export type SendPreparedTransactionInput = {
  transaction: PreparedTransactionRequest;
  privateKey: string;
  fromAddress: EvmAddress;
  chainId: number;
  waitForReceipt?: boolean;
};

export type SendPreparedTransactionResult = {
  hash: string;
  chainId: number;
  toAddress: string;
  explorerUrl: string | null;
};

function normalizeAmount(amount: string): string {
  return amount.trim().replace(",", ".");
}

function assertValidRecipient(toAddress: string): asserts toAddress is EvmAddress {
  if (!isAddress(toAddress)) {
    throw new Error("Invalid recipient address.");
  }
}

function assertValidAmount(amount: string): void {
  const normalizedAmount = normalizeAmount(amount);

  if (!normalizedAmount) {
    throw new Error("Amount is required.");
  }

  if (!/^\d+(\.\d+)?$/.test(normalizedAmount)) {
    throw new Error("Invalid amount.");
  }

  if (Number(normalizedAmount) <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
}

function getExplorerTxUrl(blockExplorerUrl: string, txHash: string): string {
  return `${blockExplorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}


function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getAlreadyKnownRawTransaction(error: unknown): string | null {
  const message = getErrorMessage(error).toLowerCase();

  if (!message.includes("already known")) {
    return null;
  }

  const maybePayload = error as {
    payload?: {
      method?: string;
      params?: unknown[];
    };
  };

  const rawTransaction = maybePayload.payload?.params?.[0];

  if (typeof rawTransaction !== "string") {
    return null;
  }

  if (!rawTransaction.startsWith("0x")) {
    return null;
  }

  return rawTransaction;
}

export class SendAssetService {
  async sendAsset(input: SendAssetInput): Promise<SendAssetResult> {
    assertValidRecipient(input.toAddress);
    assertValidAmount(input.amount);

    if (input.asset.chainId !== input.chainId) {
      throw new Error("Asset network does not match selected network.");
    }

    const chain = networkService.getRequiredChainById(input.chainId);
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const signer = new Wallet(input.privateKey, provider);
    const normalizedAmount = normalizeAmount(input.amount);

    if (input.asset.type === "native") {
      const value = parseUnits(normalizedAmount, input.asset.decimals);

      const balance = await provider.getBalance(input.fromAddress);

      if (balance < value) {
        throw new Error(`Insufficient ${input.asset.symbol} balance.`);
      }

      const feeData = await provider.getFeeData();

      const gasLimit = await provider.estimateGas({
        from: input.fromAddress,
        to: input.toAddress,
        value,
      });

      const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;

      if (maxFeePerGas) {
        const estimatedFee = gasLimit * maxFeePerGas;
        const totalRequired = value + estimatedFee;

        if (balance < totalRequired) {
          throw new Error(
            `Insufficient ${input.asset.symbol} for amount and gas. Estimated gas fee: ${formatEther(
              estimatedFee,
            )} ${input.asset.symbol}.`,
          );
        }
      }

      const tx = await signer.sendTransaction({
        to: input.toAddress,
        value,
      });

      return {
        hash: tx.hash,
        chainId: input.chainId,
        assetSymbol: input.asset.symbol,
        amount: normalizedAmount,
        toAddress: input.toAddress,
        explorerUrl: getExplorerTxUrl(chain.blockExplorerUrl, tx.hash),
      };
    }

    if (input.asset.type === "erc20") {
      if (!input.asset.contractAddress) {
        throw new Error("Token contract address is missing.");
      }

      const amountRaw = parseUnits(normalizedAmount, input.asset.decimals);

      if (BigInt(input.asset.balanceRaw) < amountRaw) {
        throw new Error(`Insufficient ${input.asset.symbol} balance.`);
      }

      const nativeBalance = await provider.getBalance(input.fromAddress);

      if (nativeBalance === 0n) {
        throw new Error(
          `You need ${chain.nativeCurrency.symbol} to pay gas for this transfer.`,
        );
      }

      const tokenContract = new Contract(
        input.asset.contractAddress,
        ERC20_TRANSFER_ABI,
        signer,
      );

      const tx = await tokenContract.transfer(input.toAddress, amountRaw);

      return {
        hash: tx.hash,
        chainId: input.chainId,
        assetSymbol: input.asset.symbol,
        amount: normalizedAmount,
        toAddress: input.toAddress,
        explorerUrl: getExplorerTxUrl(chain.blockExplorerUrl, tx.hash),
      };
    }

    throw new Error("Unsupported asset type.");
  }

  async sendPreparedTransaction(
    input: SendPreparedTransactionInput,
  ): Promise<SendPreparedTransactionResult> {
    assertValidRecipient(input.transaction.to);

    const chain = networkService.getRequiredChainById(input.chainId);
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const signer = new Wallet(input.privateKey, provider);

    const value = input.transaction.value
      ? BigInt(input.transaction.value)
      : 0n;

    const data = input.transaction.data ?? "0x";

    const balance = await provider.getBalance(input.fromAddress);

    const gasLimit = await provider.estimateGas({
      from: input.fromAddress,
      to: input.transaction.to,
      data,
      value,
    });

    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;

    if (maxFeePerGas) {
      const estimatedFee = gasLimit * maxFeePerGas;
      const totalRequired = value + estimatedFee;

      if (balance < totalRequired) {
        throw new Error(
          `Insufficient ${chain.nativeCurrency.symbol} for swap and gas. Estimated gas fee: ${formatEther(
            estimatedFee,
          )} ${chain.nativeCurrency.symbol}.`,
        );
      }
    }

    try {
      const tx = await signer.sendTransaction({
        to: input.transaction.to,
        data,
        value,
        gasLimit,
      });

      if (input.waitForReceipt) {
        await tx.wait(1);
      }

      return {
        hash: tx.hash,
        chainId: input.chainId,
        toAddress: input.transaction.to,
        explorerUrl: getExplorerTxUrl(chain.blockExplorerUrl, tx.hash),
      };
    } catch (error) {
      const alreadyKnownRawTransaction = getAlreadyKnownRawTransaction(error);

      if (!alreadyKnownRawTransaction) {
        throw error;
      }

      const txHash = keccak256(alreadyKnownRawTransaction);

      if (input.waitForReceipt) {
        await provider.waitForTransaction(txHash, 1, 120_000);
      }

      return {
        hash: txHash,
        chainId: input.chainId,
        toAddress: input.transaction.to,
        explorerUrl: getExplorerTxUrl(chain.blockExplorerUrl, txHash),
      };
    }
  }
}

export const sendAssetService = new SendAssetService();
