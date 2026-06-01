// src/core/swap/zeroXSwapService.ts

export const ZERO_X_NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ZERO_X_BASE_URL = "https://api.0x.org";
const SIMPL_SWAP_PROXY_URL = (import.meta.env.VITE_SIMPL_SWAP_PROXY_URL ?? "")
  .trim()
  .replace(/\/+$/u, "");

function getZeroXBaseUrl(): string {
  return SIMPL_SWAP_PROXY_URL || ZERO_X_BASE_URL;
}

function getZeroXRequestHeaders(): Record<string, string> | undefined {
  if (SIMPL_SWAP_PROXY_URL) {
    return undefined;
  }

  return {
    "0x-api-key": getZeroXApiKey(),
    "0x-version": "v2",
  };
}


const SIMPLE_SWAP_FEE_RECIPIENT_PLACEHOLDER = "0xYOUR_FEE_WALLET_ADDRESS";

function isNativeTokenAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_X_NATIVE_TOKEN_ADDRESS.toLowerCase();
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function getSimpleSwapFeeRecipient(): string | null {
  const recipient = import.meta.env.VITE_SIMPLE_SWAP_FEE_RECIPIENT;

  if (!recipient || recipient === SIMPLE_SWAP_FEE_RECIPIENT_PLACEHOLDER) {
    return null;
  }

  if (!isEvmAddress(recipient)) {
    throw new Error("Invalid VITE_SIMPLE_SWAP_FEE_RECIPIENT address.");
  }

  return recipient;
}

export function getSimpleSwapFeeBps(): number {
  const rawBps = import.meta.env.VITE_SIMPLE_SWAP_FEE_BPS;

  if (!rawBps) {
    return 0;
  }

  const bps = Number(rawBps);

  if (!Number.isInteger(bps) || bps < 0 || bps > 1000) {
    throw new Error("VITE_SIMPLE_SWAP_FEE_BPS must be an integer from 0 to 1000.");
  }

  return bps;
}

function getSimpleSwapFeeToken(params: {
  sellToken: string;
  buyToken: string;
}): string {
  // Prefer fee in buy token, but if buy token is native, use sell token.
  // This keeps BNB -> USDT fee in USDT, and USDC -> BNB fee in USDC.
  if (isNativeTokenAddress(params.buyToken)) {
    return params.sellToken;
  }

  return params.buyToken;
}

function appendSimpleSwapFeeParams(
  searchParams: URLSearchParams,
  params: {
    sellToken: string;
    buyToken: string;
  },
): void {
  const recipient = getSimpleSwapFeeRecipient();
  const bps = getSimpleSwapFeeBps();

  if (!recipient || bps <= 0) {
    return;
  }

  if (SIMPL_SWAP_PROXY_URL) {
    searchParams.delete("swapFeeRecipient");
    searchParams.delete("swapFeeBps");
    searchParams.delete("swapFeeToken");
    return;
  }

  searchParams.set("swapFeeRecipient", recipient);
  searchParams.set("swapFeeBps", String(bps));
  searchParams.set("swapFeeToken", getSimpleSwapFeeToken(params));
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
  swapFeeRecipient?: string;
  swapFeeBps?: number;
  swapFeeToken?: string;
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

  appendSimpleSwapFeeParams(searchParams, {
    sellToken: params.sellToken,
    buyToken: params.buyToken,
  });

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

  appendSimpleSwapFeeParams(searchParams, {
    sellToken: params.sellToken,
    buyToken: params.buyToken,
  });

  if (typeof params.slippageBps === "number") {
    searchParams.set("slippageBps", String(params.slippageBps));
  }

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
