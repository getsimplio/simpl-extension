// src/core/swap/zeroXSwapService.ts

import { parseTradeApiResponse, type SimplTradeQuote } from "../trade/quote-response";

export const ZERO_X_NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ZERO_X_BASE_URL = "https://api.0x.org";
const SIMPL_SWAP_PROXY_URL = (import.meta.env.VITE_SIMPL_SWAP_PROXY_URL ?? "")
  .trim()
  .replace(/\/+$/u, "");

// Production MUST route 0x through the Simpl swap proxy (server-side API key,
// no client secret, no direct provider call). Only a development build may fall
// back to calling api.0x.org directly with a client-side key. This blocks the
// insecure path if a production build is ever made without the proxy configured,
// without changing the working (proxy-configured) flow. See
// src/core/network/endpoint-inventory.ts (zerox: mustUseProxy).
function getZeroXBaseUrl(): string {
  if (SIMPL_SWAP_PROXY_URL) {
    return SIMPL_SWAP_PROXY_URL;
  }
  if (import.meta.env.PROD) {
    throw new Error(
      "Swaps are unavailable: the Simpl swap proxy is not configured for this build.",
    );
  }
  // Dev-only direct fallback.
  return ZERO_X_BASE_URL;
}

function getZeroXRequestHeaders(): Record<string, string> | undefined {
  if (SIMPL_SWAP_PROXY_URL) {
    return undefined;
  }

  // Reached only in development (production throws in getZeroXBaseUrl above).
  // The client-side 0x key is a DEV convenience, never a production secret.
  if (import.meta.env.PROD) {
    throw new Error("Swap proxy is required in production.");
  }

  return {
    "0x-api-key": getZeroXApiKey(),
    "0x-version": "v2",
  };
}


/**
 * Production fees are backend-authoritative. The extension must display the fee
 * breakdown returned by getsimpl-api and must NOT override fee bps or the fee
 * recipient client-side. This strips any legacy fee-override params so they are
 * never sent to 0x / the proxy; the gateway injects the fee server-side.
 */
function stripClientFeeParams(searchParams: URLSearchParams): void {
  searchParams.delete("swapFeeRecipient");
  searchParams.delete("swapFeeBps");
  searchParams.delete("swapFeeToken");
}



export type ZeroXAllowanceIssue = {
  actual?: string;
  spender?: string;
};

export type ZeroXBalanceIssue = {
  token?: string;
  actual?: string;
  expected?: string;
};

export type ZeroXSwapIssues = {
  allowance?: ZeroXAllowanceIssue | null;
  balance?: ZeroXBalanceIssue | null;
  simulationIncomplete?: boolean;
  invalidSourcesPassed?: string[];
};

export type ZeroXRouteFill = {
  from?: string;
  to?: string;
  source?: string;
  proportionBps?: string;
};

export type ZeroXSwapRoute = {
  fills?: ZeroXRouteFill[];
  tokens?: Array<{
    address?: string;
    symbol?: string;
  }>;
};

export type ZeroXSwapPrice = {
  allowanceTarget?: string;
  blockNumber?: string;
  buyAmount?: string;
  buyToken?: string;
  fees?: {
    integratorFee?: {
      amount: string;
      token: string;
      type: string;
    } | null;
    integratorFees?: Array<{
      amount: string;
      token: string;
      type: string;
    }>;
    zeroExFee?: {
      amount: string;
      token: string;
      type: string;
    } | null;
    gasFee?: unknown;
  };
  gas?: string;
  gasPrice?: string;
  issues?: ZeroXSwapIssues;
  liquidityAvailable?: boolean;
  minBuyAmount?: string;
  route?: ZeroXSwapRoute;
  sellAmount?: string;
  sellToken?: string;
  totalNetworkFee?: string;
  zid?: string;
};

export type ZeroXSwapQuoteTransaction = {
  to: string;
  data: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
};

export type ZeroXSwapQuote = ZeroXSwapPrice & {
  transaction: ZeroXSwapQuoteTransaction;
};


export type GetZeroXSwapPriceParams = {
  chainId: number;
  sellToken: string;
  buyToken: string;
  // Exactly one of sellAmount / buyAmount drives the quote. sellAmount =
  // "sell this much" (sell/exact-in mode); buyAmount = "receive this much"
  // (buy/exact-out mode). When buyAmount is set and non-zero it wins.
  sellAmount: string;
  buyAmount?: string;
  taker: string;
};

export type GetZeroXSwapQuoteParams = GetZeroXSwapPriceParams & {
  slippageBps?: number;
  // NOTE: no swapFee* fields. Production fees are backend-authoritative — the
  // gateway injects the fee server-side. Any legacy fee-override params are
  // stripped by stripClientFeeParams before the request leaves the extension.
};

export class ZeroXSwapApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ZeroXSwapApiError";
    this.status = status;
    this.details = details;
  }
}

function getZeroXApiKey(): string {
  const apiKey = import.meta.env.VITE_0X_API_KEY;

  if (
    !apiKey ||
    apiKey === "your_key_here" ||
    apiKey === "your_0x_api_key_here" ||
    apiKey === "PASTE_YOUR_REAL_0X_KEY_HERE"
  ) {
    throw new Error(
      "Missing VITE_0X_API_KEY. Add your real 0x key to .env.local and rebuild.",
    );
  }

  return apiKey;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "reason" in payload &&
    typeof payload.reason === "string"
  ) {
    return payload.reason;
  }

  if (typeof payload === "string") {
    return payload;
  }

  return "0x Swap API request failed";
}

export async function getZeroXSwapPrice(
  params: GetZeroXSwapPriceParams,
): Promise<ZeroXSwapPrice> {
  const searchParams = new URLSearchParams({
    chainId: String(params.chainId),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    taker: params.taker,
  });

  if (params.buyAmount && params.buyAmount !== "0") {
    searchParams.set("buyAmount", params.buyAmount);
  } else {
    searchParams.set("sellAmount", params.sellAmount);
  }

  stripClientFeeParams(searchParams);
  // Opt into the getsimpl-api v2 normalized response (backend still defaults to
  // the legacy shape until deployed; the parser handles both).
  searchParams.set("format", "v2");

  const response = await fetch(
    `${getZeroXBaseUrl()}/swap/allowance-holder/price?${searchParams.toString()}`,
    {
      method: "GET",
      headers: getZeroXRequestHeaders(),
    },
  );

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new ZeroXSwapApiError(
      getErrorMessage(payload),
      response.status,
      payload,
    );
  }

  return payload as ZeroXSwapPrice;
}


export async function getZeroXSwapQuote(
  params: GetZeroXSwapQuoteParams,
): Promise<ZeroXSwapQuote> {
  const searchParams = new URLSearchParams({
    chainId: String(params.chainId),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    taker: params.taker,
  });

  if (params.buyAmount && params.buyAmount !== "0") {
    searchParams.set("buyAmount", params.buyAmount);
  } else {
    searchParams.set("sellAmount", params.sellAmount);
  }

  stripClientFeeParams(searchParams);

  // Slippage is a user preference (tolerance), NOT a fee — safe to send.
  if (typeof params.slippageBps === "number") {
    searchParams.set("slippageBps", String(params.slippageBps));
  }
  searchParams.set("format", "v2");

  const response = await fetch(
    `${getZeroXBaseUrl()}/swap/allowance-holder/quote?${searchParams.toString()}`,
    {
      method: "GET",
      headers: getZeroXRequestHeaders(),
    },
  );

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new ZeroXSwapApiError(
      getErrorMessage(payload),
      response.status,
      payload,
    );
  }

  return payload as ZeroXSwapQuote;
}

export function getZeroXRouteLabel(price: ZeroXSwapPrice | null): string {
  const fills = price?.route?.fills ?? [];

  const sources = Array.from(
    new Set(
      fills
        .map((fill) => fill.source)
        .filter((source): source is string => Boolean(source)),
    ),
  );

  if (sources.length === 0) {
    return "0x";
  }

  return sources.slice(0, 3).join(" / ");
}

// Normalize a 0x price/quote (or a getsimpl-api v2 envelope) into the shared
// SimplTradeQuote. Handles the current legacy 0x shape today and the v2 shape
// once getsimpl-api deploys it — the UI fee breakdown reads this.
export function toSimplSwapQuote(payload: unknown): SimplTradeQuote {
  return parseTradeApiResponse(payload, { kind: "swap", provider: "zeroex" });
}

export function getZeroXAllowanceSpender(
  price: ZeroXSwapPrice | null,
): string | null {
  return price?.issues?.allowance?.spender ?? price?.allowanceTarget ?? null;
}

export function hasZeroXAllowanceIssue(price: ZeroXSwapPrice | null): boolean {
  return Boolean(price?.issues?.allowance?.spender);
}

export function hasZeroXBalanceIssue(price: ZeroXSwapPrice | null): boolean {
  return Boolean(price?.issues?.balance);
}
