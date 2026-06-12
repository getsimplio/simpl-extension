// src/chains/solana/solana.rpc.ts
//
// Resilient Solana RPC access: a connection factory plus fallback runners that
// try each configured endpoint in order (see solana.config.getSolanaRpcUrls).
// The public `api.mainnet-beta.solana.com` rejects many extension/browser
// origins with 403; rotating to the next endpoint on 403/429/network/invalid
// response keeps balances/activity working.
//
// SECURITY: only public read RPC calls flow through here. We never log request
// bodies, secret keys, mnemonics or addresses — dev diagnostics are limited to
// the endpoint host, an HTTP status hint and the normalized error code.

import { Connection } from "@solana/web3.js";
import { getSolanaRpcUrls, type SolanaChainConfig } from "./solana.config";
import { normalizeSolanaError } from "./solana.errors";

const env = import.meta.env as { DEV?: boolean } | undefined;
const isDev = Boolean(env?.DEV);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

// Best-effort HTTP status hint pulled from a web3.js/fetch error message, for
// dev diagnostics only. Never inspects or logs the request body.
function statusHint(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = text.match(/\b(40[13]|429|5\d\d)\b/);
  return match ? match[1] : "n/a";
}

function logRpcFailure(
  url: string,
  error: unknown,
  index: number,
  total: number,
): void {
  if (!isDev) return;
  // Dev-only diagnostics: host + status + normalized code. No secrets, no body.
  console.warn(
    `[solana-rpc] endpoint ${index + 1}/${total} (${hostOf(url)}) failed`,
    { status: statusHint(error), code: normalizeSolanaError(error).code },
  );
}

// Default per-endpoint deadline for a single read. Long enough for a healthy
// public RPC to answer, short enough that a dead/slow endpoint (504, hung
// socket) rotates to the next one quickly instead of stalling the whole flow.
const DEFAULT_RPC_TIMEOUT_MS = 6000;

// Wrap fetch so each RPC HTTP call is bounded: it aborts at `timeoutMs` and
// surfaces as a network error, which lets withSolanaRead rotate to the next
// endpoint. Any caller-supplied abort signal is chained in so callers can still
// cancel. SECURITY: never inspects or logs the request body.
function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = init?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else
        callerSignal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
    });
  };
}

// A web3.js Connection for one endpoint. "confirmed" is a good wallet default
// (fast, final enough for balances + sends). When `timeoutMs` is given the
// connection's HTTP calls are abort-bounded and web3.js's internal rate-limit
// retry loop is disabled, so a slow endpoint fails fast and we move to the next
// one (we do our own endpoint rotation in withSolanaRead).
export function createSolanaConnection(
  rpcUrl: string,
  options?: { timeoutMs?: number },
): Connection {
  const timeoutMs = options?.timeoutMs;
  if (timeoutMs && timeoutMs > 0) {
    return new Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: createTimeoutFetch(timeoutMs),
      disableRetryOnRateLimit: true,
    });
  }
  return new Connection(rpcUrl, "confirmed");
}

// Reject if `promise` doesn't settle within `timeoutMs`. The underlying RPC call
// is also abort-bounded via the connection's timeout fetch, so the timed-out
// endpoint stops working shortly after we move on; its late result is ignored.
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Solana RPC request timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Run a READ-ONLY op against the config's endpoints in order, falling back to
// the next on any failure (403/429/504/timeout/network/invalid response). Each
// endpoint attempt is bounded by `timeoutMs` so a single slow/dead RPC can never
// stall the whole flow. Throws a single normalized SolanaError only when every
// endpoint fails. Use ONLY for idempotent reads — never for broadcasting a
// transaction (a timeout mid-broadcast could otherwise double-send).
export async function withSolanaRead<T>(
  config: SolanaChainConfig,
  op: (connection: Connection) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const urls = getSolanaRpcUrls(config);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  let lastError: unknown = null;

  for (let index = 0; index < urls.length; index += 1) {
    try {
      return await withTimeout(
        op(createSolanaConnection(urls[index], { timeoutMs })),
        timeoutMs,
      );
    } catch (error) {
      lastError = error;
      logRpcFailure(urls[index], error, index, urls.length);
    }
  }

  throw normalizeSolanaError(lastError);
}

// Resolve a connection on the first endpoint that answers a cheap, idempotent
// probe (getLatestBlockhash). Used for WRITES (send) so the broadcast happens
// exactly once on a known-good endpoint and is never retried across endpoints
// (which could double-send). Throws a normalized SolanaError if all are down.
export async function resolveHealthySolanaConnection(
  config: SolanaChainConfig,
): Promise<Connection> {
  const urls = getSolanaRpcUrls(config);
  let lastError: unknown = null;

  for (let index = 0; index < urls.length; index += 1) {
    try {
      const connection = createSolanaConnection(urls[index]);
      await connection.getLatestBlockhash();
      return connection;
    } catch (error) {
      lastError = error;
      logRpcFailure(urls[index], error, index, urls.length);
    }
  }

  throw normalizeSolanaError(lastError);
}
