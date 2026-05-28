// src/core/swap/pancakeV2SwapService.ts

import { Contract, Interface, JsonRpcProvider } from "ethers";
import {
  BNB_SMART_CHAIN_ID,
  getRequiredChainById,
} from "../networks/chain-registry";
import {
  ZERO_X_NATIVE_TOKEN_ADDRESS,
  type GetZeroXSwapPriceParams,
  type GetZeroXSwapQuoteParams,
  type ZeroXSwapPrice,
  type ZeroXSwapQuote,
} from "./zeroXSwapService";

export const PANCAKE_V2_ROUTER_ADDRESS =
  "0x10ED43C718714eb63d5aA57B78B54704E256024E";

export const BSC_WBNB_ADDRESS =
  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const PANCAKE_V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
];

const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const pancakeRouterInterface = new Interface(PANCAKE_V2_ROUTER_ABI);

function isNativeTokenAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_X_NATIVE_TOKEN_ADDRESS.toLowerCase();
}

function normalizeTokenForPath(address: string): string {
  return isNativeTokenAddress(address) ? BSC_WBNB_ADDRESS : address;
}

function getPancakeProvider(chainId: number): JsonRpcProvider {
  if (chainId !== BNB_SMART_CHAIN_ID) {
    throw new Error(`PancakeSwap V2 fallback supports only BNB Chain. Got ${chainId}.`);
  }

  const chain = getRequiredChainById(chainId);

  return new JsonRpcProvider(chain.rpcUrl, chain.chainId);
}

function buildPancakePath(input: {
  sellToken: string;
  buyToken: string;
}): string[] {
  const sell = normalizeTokenForPath(input.sellToken);
  const buy = normalizeTokenForPath(input.buyToken);

  if (sell.toLowerCase() === buy.toLowerCase()) {
    throw new Error("Sell token and buy token are the same.");
  }

  if (
    sell.toLowerCase() === BSC_WBNB_ADDRESS.toLowerCase() ||
    buy.toLowerCase() === BSC_WBNB_ADDRESS.toLowerCase()
  ) {
    return [sell, buy];
  }

  return [sell, BSC_WBNB_ADDRESS, buy];
}

function clampSlippageBps(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  return Math.min(5000, Math.max(1, Math.trunc(value ?? 50)));
}

function applySlippage(amount: bigint, slippageBps: number | undefined): bigint {
  const safeSlippageBps = clampSlippageBps(slippageBps);

  return (amount * BigInt(10_000 - safeSlippageBps)) / 10_000n;
}

async function getPancakeAmountsOut(input: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
}): Promise<{
  path: string[];
  amounts: bigint[];
}> {
  const provider = getPancakeProvider(input.chainId);
  const router = new Contract(
    PANCAKE_V2_ROUTER_ADDRESS,
    PANCAKE_V2_ROUTER_ABI,
    provider,
  );

  const path = buildPancakePath({
    sellToken: input.sellToken,
    buyToken: input.buyToken,
  });

  const amounts = (await router.getAmountsOut(
    BigInt(input.sellAmount),
    path,
  )) as bigint[];

  if (!Array.isArray(amounts) || amounts.length < 2) {
    throw new Error("PancakeSwap V2 route returned no amounts.");
  }

  return {
    path,
    amounts,
  };
}

async function getAllowance(input: {
  chainId: number;
  token: string;
  owner: string;
}): Promise<bigint> {
  if (isNativeTokenAddress(input.token)) {
    return 2n ** 256n - 1n;
  }

  const provider = getPancakeProvider(input.chainId);
  const token = new Contract(input.token, ERC20_ALLOWANCE_ABI, provider);

  return (await token.allowance(
    input.owner,
    PANCAKE_V2_ROUTER_ADDRESS,
  )) as bigint;
}

function toPancakePrice(input: {
  params: GetZeroXSwapPriceParams;
  buyAmount: bigint;
  minBuyAmount?: bigint;
  allowance: bigint;
  path: string[];
  slippageBps?: number;
}): ZeroXSwapPrice {
  const sellAmount = BigInt(input.params.sellAmount);
  const hasAllowanceIssue =
    !isNativeTokenAddress(input.params.sellToken) && input.allowance < sellAmount;

  return {
    allowanceTarget: PANCAKE_V2_ROUTER_ADDRESS,
    buyAmount: input.buyAmount.toString(),
    buyToken: input.params.buyToken,
    gas: "450000",
    gasPrice: undefined,
    issues: {
      allowance: hasAllowanceIssue
        ? {
            actual: input.allowance.toString(),
            spender: PANCAKE_V2_ROUTER_ADDRESS,
          }
        : null,
      balance: null,
      simulationIncomplete: true,
    },
    liquidityAvailable: true,
    minBuyAmount: (input.minBuyAmount ?? input.buyAmount).toString(),
    route: {
      fills: [
        {
          from: input.params.sellToken,
          to: input.params.buyToken,
          source: "PancakeSwap V2",
          proportionBps: "10000",
        },
      ],
      tokens: [
        {
          address: input.params.sellToken,
        },
        {
          address: input.params.buyToken,
        },
      ],
    },
    sellAmount: input.params.sellAmount,
    sellToken: input.params.sellToken,
    totalNetworkFee: undefined,
  };
}

export function isPancakeV2SupportedChain(chainId: number): boolean {
  return chainId === BNB_SMART_CHAIN_ID;
}

export async function getPancakeV2SwapPrice(
  params: GetZeroXSwapPriceParams,
): Promise<ZeroXSwapPrice> {
  const { amounts, path } = await getPancakeAmountsOut({
    chainId: params.chainId,
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
  });

  const allowance = await getAllowance({
    chainId: params.chainId,
    token: params.sellToken,
    owner: params.taker,
  });

  const buyAmount = amounts[amounts.length - 1];

  return toPancakePrice({
    params,
    buyAmount,
    allowance,
    path,
  });
}

export async function getPancakeV2SwapQuote(
  params: GetZeroXSwapQuoteParams,
): Promise<ZeroXSwapQuote> {
  const { amounts, path } = await getPancakeAmountsOut({
    chainId: params.chainId,
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
  });

  const buyAmount = amounts[amounts.length - 1];
  const minBuyAmount = applySlippage(buyAmount, params.slippageBps);

  const allowance = await getAllowance({
    chainId: params.chainId,
    token: params.sellToken,
    owner: params.taker,
  });

  const price = toPancakePrice({
    params,
    buyAmount,
    minBuyAmount,
    allowance,
    path,
    slippageBps: params.slippageBps,
  });

  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  let data: string;
  let value = "0";

  if (isNativeTokenAddress(params.sellToken)) {
    value = params.sellAmount;
    data = pancakeRouterInterface.encodeFunctionData(
      "swapExactETHForTokensSupportingFeeOnTransferTokens",
      [minBuyAmount, path, params.taker, deadline],
    );
  } else if (isNativeTokenAddress(params.buyToken)) {
    data = pancakeRouterInterface.encodeFunctionData(
      "swapExactTokensForETHSupportingFeeOnTransferTokens",
      [BigInt(params.sellAmount), minBuyAmount, path, params.taker, deadline],
    );
  } else {
    data = pancakeRouterInterface.encodeFunctionData(
      "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      [BigInt(params.sellAmount), minBuyAmount, path, params.taker, deadline],
    );
  }

  return {
    ...price,
    transaction: {
      to: PANCAKE_V2_ROUTER_ADDRESS,
      data,
      value,
      gas: "450000",
    },
  };
}
