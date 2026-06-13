// src/core/balances/chain-balance.service.ts
//
// Chain-aware token-balance resolver for the unified Swap screen. Given an
// owner, a chain, and a token (native or ERC-20), it returns an EXPLICIT state
// — loading is the caller's concern; this returns loaded / unavailable / error
// — so the UI never shows a fake "0".
//
// It reads only public chain state over the registry RPC (no key material, no
// backend, no LI.FI). Balances are available only for EVM chains the wallet has
// a configured RPC for (the local registry). For every other chain — non-EVM,
// or an EVM chain without a configured RPC — the balance is "unavailable" and
// the UI shows "—" rather than a misleading zero.

import { getChainById } from "../networks/chain-registry";

// ── Low-level JSON-RPC reads (registry EVM chains only) ─────────────────────
// A `null` result means "could not read" (chain not supported, RPC failed, or
// a reverted call). A genuine zero balance returns 0n, not null — so callers
// can distinguish "loaded zero" from "unknown".

async function ethCall(
  chainId: number,
  to: string,
  data: string,
): Promise<string | null> {
  const chain = getChainById(chainId);
  if (!chain) return null;
  try {
    const response = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: string };
    return payload.result ?? null;
  } catch {
    return null;
  }
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/u, "").padStart(64, "0");
}

// allowance(address owner, address spender) → 0xdd62ed3e
export async function readErc20Allowance(params: {
  chainId: number;
  tokenAddress: string;
  owner: string;
  spender: string;
}): Promise<bigint | null> {
  const data = `0xdd62ed3e${padAddress(params.owner)}${padAddress(
    params.spender,
  )}`;
  const result = await ethCall(params.chainId, params.tokenAddress, data);
  if (!result || result === "0x") return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

// balanceOf(address owner) → 0x70a08231
export async function readErc20Balance(params: {
  chainId: number;
  tokenAddress: string;
  owner: string;
}): Promise<bigint | null> {
  const data = `0x70a08231${padAddress(params.owner)}`;
  const result = await ethCall(params.chainId, params.tokenAddress, data);
  if (!result || result === "0x") return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

export async function readNativeBalance(params: {
  chainId: number;
  owner: string;
}): Promise<bigint | null> {
  const chain = getChainById(params.chainId);
  if (!chain) return null;
  try {
    const response = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [params.owner, "latest"],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: string };
    if (!payload.result) return null;
    return BigInt(payload.result);
  } catch {
    return null;
  }
}

// ── Resolver ────────────────────────────────────────────────────────────────

export type BalanceStatus = "loading" | "loaded" | "unavailable" | "error";

export type ResolvedBalance = {
  status: BalanceStatus;
  // Populated only when status === "loaded"; null otherwise (never a fake 0).
  baseUnits: string | null;
  formatted: string | null;
};

export const LOADING_BALANCE: ResolvedBalance = {
  status: "loading",
  baseUnits: null,
  formatted: null,
};

export const UNAVAILABLE_BALANCE: ResolvedBalance = {
  status: "unavailable",
  baseUnits: null,
  formatted: null,
};

// Trim base units to a short, human display string (≤6 fractional places).
function formatUnits(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, 6)
    .replace(/0+$/u, "");
  if (!fracStr) {
    // Non-zero but rounds below the displayed precision.
    return whole === 0n ? "<0.000001" : whole.toLocaleString("en-US");
  }
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

// Whether a token's balance can be read at all (registry EVM chain). Non-EVM /
// unconfigured chains return false → the UI shows "—", never "0".
export function isBalanceResolvable(chainId: number): boolean {
  return getChainById(chainId)?.family === "evm";
}

// Resolve a token balance to an explicit state. Never returns a fabricated 0:
// a 0 is only returned when the chain actually reported a zero balance.
export async function resolveChainTokenBalance(params: {
  owner: string | null;
  chainId: number;
  tokenAddress: string | null; // null → native
  isNative: boolean;
  decimals: number;
}): Promise<ResolvedBalance> {
  if (!params.owner || !isBalanceResolvable(params.chainId)) {
    return UNAVAILABLE_BALANCE;
  }

  const raw =
    params.isNative || !params.tokenAddress
      ? await readNativeBalance({ chainId: params.chainId, owner: params.owner })
      : await readErc20Balance({
          chainId: params.chainId,
          tokenAddress: params.tokenAddress,
          owner: params.owner,
        });

  if (raw == null) {
    // The chain is supported but the read failed (RPC error / reverted call).
    return { status: "error", baseUnits: null, formatted: null };
  }

  return {
    status: "loaded",
    baseUnits: raw.toString(),
    formatted: formatUnits(raw, params.decimals),
  };
}
