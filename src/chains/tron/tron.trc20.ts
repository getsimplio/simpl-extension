// src/chains/tron/tron.trc20.ts
//
// TRC-20 transfer preparation. Builds the unsigned transaction for a token
// `transfer(address,uint256)` call via TronWeb's smart-contract trigger. Signing
// and broadcasting are handled by tron.signer.ts so the private key never enters
// this module.
//
// NOTE: this is the preparation layer for TRC-20 sends. It is intentionally not
// wired into the UI yet — native TRX must work and the build must pass first.

import type { Types } from "tronweb";
import { getTronWeb } from "./tron.balance";
import { TRC20_DEFAULT_FEE_LIMIT_SUN } from "./tron.config";
import { isValidTronAddress } from "./tron.address";
import { tronError, normalizeTronError } from "./tron.errors";

// Fee ceiling (in sun) used when a caller does not specify one. TRON charges
// TRC-20 transfers in energy/bandwidth, paid for in TRX up to this limit.
export const TRC20_TRANSFER_FEE_LIMIT_SUN = 30_000_000;

export type BuildTrc20TransferInput = {
  contractAddress: string;
  fromAddress: string;
  toAddress: string;
  // Amount in token base units (already scaled by the token's decimals).
  amount: bigint | string;
  feeLimit?: number;
};

// Build an unsigned TRC-20 transfer transaction. Returns the unsigned tx for the
// signer to sign + broadcast; this function never touches the private key.
export async function buildTrc20TransferTransaction(
  input: BuildTrc20TransferInput,
): Promise<Types.Transaction> {
  if (!isValidTronAddress(input.toAddress)) {
    throw tronError("INVALID_TRON_ADDRESS", "Invalid recipient address.");
  }

  const amount = BigInt(input.amount);

  if (amount <= 0n) {
    throw tronError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  try {
    const tronWeb = getTronWeb();

    const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
      input.contractAddress,
      "transfer(address,uint256)",
      {
        feeLimit: input.feeLimit ?? TRC20_DEFAULT_FEE_LIMIT_SUN,
        callValue: 0,
      },
      [
        { type: "address", value: input.toAddress },
        { type: "uint256", value: amount.toString() },
      ],
      input.fromAddress,
    );

    if (!transaction) {
      throw tronError("TRON_BUILD_TX_FAILED", "Could not build the transfer.");
    }

    return transaction;
  } catch (error) {
    throw normalizeTronError(error, { isToken: true });
  }
}
