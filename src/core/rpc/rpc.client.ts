// src/core/rpc/rpc.client.ts
// eth_estimateGas
// eth_sendRawTransaction
// eth_getTransactionCount
// eth_call
export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: unknown[];
};

export type JsonRpcSuccessResponse<T> = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: T;
};

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse<T> =
  | JsonRpcSuccessResponse<T>
  | JsonRpcErrorResponse;

// Opt-in per-request timeout. Omitted by default so existing callers (incl.
// eth_sendRawTransaction) keep their current no-timeout behavior — only the
// read paths below pass a timeout, which can never cause a double-broadcast.
export type RpcRequestOptions = {
  timeoutMs?: number;
};

const DEFAULT_READ_TIMEOUT_MS = 12_000;

export class RpcClient {
  private requestId = 1;

  async request<T>(
    rpcUrl: string,
    method: string,
    params: unknown[] = [],
    options: RpcRequestOptions = {}
  ): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.requestId,
      method,
      params,
    };

    this.requestId += 1;

    // Bound the request so a hung/slow RPC can't stall a balance refresh
    // forever (a common cause of the "stuck loading → error" path on flaky
    // public nodes). No timeout is applied unless the caller opts in.
    const controller =
      typeof options.timeoutMs === "number" ? new AbortController() : null;
    const timer =
      controller !== null
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : null;

    let response: Response;
    try {
      response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new Error(`RPC timeout after ${options.timeoutMs}ms (${method})`);
      }
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;

    if ("error" in json) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  }

  async getChainId(rpcUrl: string): Promise<number> {
    const chainIdHex = await this.request<string>(rpcUrl, "eth_chainId", [], {
      timeoutMs: DEFAULT_READ_TIMEOUT_MS,
    });

    return Number.parseInt(chainIdHex, 16);
  }

  async getBalance(rpcUrl: string, address: string): Promise<bigint> {
    // Native balance is the critical leg of a portfolio refresh: if it throws,
    // the whole refresh fails. It's a read (idempotent), so one retry on a
    // transient hiccup is safe and noticeably cuts the BNB "Couldn't refresh"
    // rate without any fallback-RPC / schema change.
    const params = [address, "latest"];

    try {
      const balanceHex = await this.request<string>(
        rpcUrl,
        "eth_getBalance",
        params,
        { timeoutMs: DEFAULT_READ_TIMEOUT_MS }
      );
      return BigInt(balanceHex);
    } catch (firstError) {
      console.debug("eth_getBalance failed, retrying once:", firstError);
      const balanceHex = await this.request<string>(
        rpcUrl,
        "eth_getBalance",
        params,
        { timeoutMs: DEFAULT_READ_TIMEOUT_MS }
      );
      return BigInt(balanceHex);
    }
  }
}

export const rpcClient = new RpcClient();