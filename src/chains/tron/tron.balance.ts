// src/chains/tron/tron.balance.ts
//
// Read-only TRON balance queries via TronGrid. All values are returned as
// integer base units (sun for TRX, 10^-decimals for TRC-20); formatting to a
// display string happens in tron.format.ts / the adapter.

import { TronWeb } from "tronweb";
import { TRON_MAINNET } from "./tron.config";
import { normalizeTronError } from "./tron.errors";

let sharedTronWeb: TronWeb | null = null;

// One stateless TronWeb instance for the whole adapter. Every call passes the
// owner / signer address explicitly, so no per-call default address is set.
export function getTronWeb(): TronWeb {
  if (!sharedTronWeb) {
    sharedTronWeb = new TronWeb({ fullHost: TRON_MAINNET.rpcUrl });
  }

  return sharedTronWeb;
}

// Native TRX balance in sun.
export async function getTrxBalance(address: string): Promise<bigint> {
  try {
    const sun = await getTronWeb().trx.getBalance(address);
    // getBalance returns a JS number; round defensively before widening.
    return BigInt(Math.round(Number(sun)) || 0);
  } catch (error) {
    throw normalizeTronError(error);
  }
}

// TRC-20 balance in base units. Uses a constant (read-only) contract call so it
// works without a signer and does not depend on the token returning a typed
// value — the raw uint256 is decoded from the hex result.
export async function getTrc20Balance(
  ownerAddress: string,
  contractAddress: string,
  _decimals: number,
): Promise<bigint> {
  try {
    const tronWeb = getTronWeb();

    const result = await tronWeb.transactionBuilder.triggerConstantContract(
      contractAddress,
      "balanceOf(address)",
      {},
      [{ type: "address", value: ownerAddress }],
      ownerAddress,
    );

    const hex = result?.constant_result?.[0];

    if (!hex || typeof hex !== "string") {
      return 0n;
    }

    return BigInt(`0x${hex}`);
  } catch (error) {
    throw normalizeTronError(error);
  }
}
