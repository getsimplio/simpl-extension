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

export class RpcClient {
  private requestId = 1;

  async request<T>(
    rpcUrl: string,
    method: string,
    params: unknown[] = []
  ): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.requestId,
      method,
      params,
    };

    this.requestId += 1;

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

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
    const chainIdHex = await this.request<string>(rpcUrl, "eth_chainId", []);

    return Number.parseInt(chainIdHex, 16);
  }

  async getBalance(rpcUrl: string, address: string): Promise<bigint> {
    const balanceHex = await this.request<string>(rpcUrl, "eth_getBalance", [
      address,
      "latest",
    ]);

    return BigInt(balanceHex);
  }
}

export const rpcClient = new RpcClient();