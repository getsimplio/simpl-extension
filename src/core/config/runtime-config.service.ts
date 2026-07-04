// src/core/config/runtime-config.service.ts
//
// Client for GET /v1/config/runtime — the server-driven runtime configuration
// (chains/assets/feature-flags/fees) shared by all Simpl apps. Stage 1 is
// strictly additive: when the gateway is unreachable the wallet behaves
// EXACTLY as it does today, because the embedded fallback config
// (buildFallbackRuntimeConfig from @getsimpl/config) mirrors the shipped
// static registries.
//
// Resolution layers (first hit wins):
//   (a) in-memory memo (module-level singleton, inflight-deduped like
//       core/api/provider-health.service.ts),
//   (b) chrome.storage.local cache under `simpl:runtimeConfig:v1`
//       (NOT localStorage — the service worker cannot see it); a fresh cache
//       (< 15 min) is returned as-is, a stale one is returned IMMEDIATELY and
//       refreshed in the background,
//   (c) network fetch from the Simpl gateway (same base-URL + 12s
//       AbortController pattern as core/prices/simpl-market-api.service.ts),
//   (d) embedded fallback — buildFallbackRuntimeConfig("extension").
//
// getRuntimeConfig() NEVER throws and never returns null; failures are logged
// fail-silent (dev-only, priceWarn style).

import {
  buildFallbackRuntimeConfig,
  normalizeRuntimeConfig,
  type SimplRuntimeConfig,
} from "@getsimpl/config";
import {
  createDefaultStorageAdapter,
  type KeyValueStorageAdapter,
} from "../storage/storage.repository";

// Resolve the gateway base URL. Same precedence as simpl-market-api.service:
// explicit market-data alias → legacy swap-proxy var → production gateway.
function resolveApiBaseUrl(): string {
  // `import.meta.env` is statically replaced by Vite; it is undefined under a
  // plain Node/tsx runtime (the check scripts), so read it defensively.
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const candidate =
    env?.VITE_SIMPL_API_URL ??
    env?.VITE_SIMPL_SWAP_PROXY_URL ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();

/** chrome.storage.local key holding the cached config envelope. */
export const RUNTIME_CONFIG_STORAGE_KEY = "simpl:runtimeConfig:v1";

// A cached config younger than this is served without any network activity.
const FRESH_TTL_MS = 15 * 60_000;
// Network timeout, mirrors simpl-market-api DEFAULT_TIMEOUT_MS.
const FETCH_TIMEOUT_MS = 12_000;
// Minimum spacing between background refresh attempts (so a dead gateway is
// not hammered on every render/navigation).
const REFRESH_BACKOFF_MS = 60_000;

// Development-only diagnostics. No-ops in production (priceWarn idiom).
const isDev = Boolean(
  (import.meta as { env?: Record<string, unknown> }).env?.DEV,
);

function configDebug(scope: string, detail: Record<string, unknown>): void {
  if (isDev) console.debug(`[config] ${scope}`, detail);
}

function configWarn(scope: string, detail: Record<string, unknown>): void {
  if (isDev) console.warn(`[config] ${scope}`, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RuntimeConfigServiceDeps {
  /** Key-value storage; defaults to chrome.storage.local (memory in tests). */
  storage?: KeyValueStorageAdapter;
  /** fetch implementation; injectable for the check script. */
  fetchImpl?: typeof fetch;
  /** Gateway base URL override (tests). */
  baseUrl?: string;
  /** Clock override (tests). */
  now?: () => number;
}

export interface RuntimeConfigService {
  /** Layered resolve — memo → storage cache → network → embedded fallback. */
  getRuntimeConfig(): Promise<SimplRuntimeConfig>;
  /**
   * Warm/refresh the config. `force` always hits the network; otherwise the
   * normal layered path runs (fresh cache → no request, stale → instant value
   * + background refresh). Never throws.
   */
  refreshRuntimeConfig(force?: boolean): Promise<SimplRuntimeConfig>;
  /** Last resolved config, synchronously. null until the first resolve lands. */
  getCachedRuntimeConfigSnapshot(): SimplRuntimeConfig | null;
  /**
   * Subscribe to snapshot changes (for useSyncExternalStore). The listener runs
   * whenever the resolved snapshot's identity changes — cache hit, network
   * refresh, or the embedded fallback landing. Returns an unsubscribe fn.
   */
  subscribe(listener: () => void): () => void;
}

export function createRuntimeConfigService(
  deps: RuntimeConfigServiceDeps = {},
): RuntimeConfigService {
  const storage = deps.storage ?? createDefaultStorageAdapter();
  // fetch must be invoked with the global receiver ("Illegal invocation"
  // otherwise), hence the arrow wrapper instead of a bare reference.
  const fetchImpl: typeof fetch =
    deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const baseUrl = deps.baseUrl ?? API_BASE_URL;
  const now = deps.now ?? Date.now;

  // (a) module-level memo. `snapshotAt` is the moment the snapshot was last
  // confirmed by the server or read from a cache envelope; the embedded
  // fallback keeps snapshotAt = 0 so it is always considered stale.
  let snapshot: SimplRuntimeConfig | null = null;
  let snapshotAt = 0;
  let inflightResolve: Promise<SimplRuntimeConfig> | null = null;
  let inflightFetch: Promise<SimplRuntimeConfig | null> | null = null;
  let lastFetchAttemptAt = 0;

  // Subscribers (useSyncExternalStore). Notified only when the snapshot's
  // identity actually changes, so a no-op refresh does not churn renders.
  const listeners = new Set<() => void>();

  function setSnapshot(config: SimplRuntimeConfig, at: number): void {
    const changed = snapshot !== config;
    snapshot = config;
    snapshotAt = at;
    if (changed) {
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          configWarn("runtime config listener failed", { error: String(error) });
        }
      }
    }
  }

  function isSnapshotFresh(): boolean {
    return (
      snapshot !== null &&
      snapshot.meta.source !== "fallback" &&
      now() - snapshotAt < FRESH_TTL_MS
    );
  }

  async function readCache(): Promise<{
    config: SimplRuntimeConfig;
    updatedAt: number;
  } | null> {
    try {
      const record = await storage.get([RUNTIME_CONFIG_STORAGE_KEY]);
      const envelope = record[RUNTIME_CONFIG_STORAGE_KEY];
      if (!isRecord(envelope)) return null;
      const config = normalizeRuntimeConfig(envelope.config);
      if (!config) return null;
      const updatedAt =
        typeof envelope.updatedAt === "number" &&
        Number.isFinite(envelope.updatedAt)
          ? envelope.updatedAt
          : 0;
      return { config, updatedAt };
    } catch (error) {
      configWarn("runtime config cache read failed", { error: String(error) });
      return null;
    }
  }

  async function writeCache(
    config: SimplRuntimeConfig,
    updatedAt: number,
  ): Promise<void> {
    try {
      await storage.set({
        [RUNTIME_CONFIG_STORAGE_KEY]: { config, updatedAt },
      });
    } catch (error) {
      configWarn("runtime config cache write failed", { error: String(error) });
    }
  }

  // (c) network fetch, deduped. Resolves null on ANY failure — never throws.
  function fetchFromNetwork(): Promise<SimplRuntimeConfig | null> {
    if (inflightFetch) return inflightFetch;
    lastFetchAttemptAt = now();
    inflightFetch = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(
          `${baseUrl}/v1/config/runtime?app=extension`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const raw: unknown = await response.json();
        // Public gateway envelope { ok, data }; tolerate a bare config payload.
        let payload: unknown = raw;
        if (isRecord(raw) && "ok" in raw) {
          if (raw.ok !== true) throw new Error("gateway envelope not ok");
          payload = raw.data;
        }
        const config = normalizeRuntimeConfig(payload);
        if (!config) throw new Error("unusable runtime config payload");
        const at = now();
        setSnapshot(config, at);
        await writeCache(config, at);
        configDebug("runtime config refreshed", {
          version: config.version,
          source: config.meta.source,
          chains: config.chains.length,
          assets: config.assets.length,
        });
        return config;
      } catch (error) {
        // Fail silent: an unreachable gateway means "use cache/fallback".
        configWarn("runtime config fetch failed", { error: String(error) });
        return null;
      } finally {
        clearTimeout(timer);
        inflightFetch = null;
      }
    })();
    return inflightFetch;
  }

  // Fire-and-forget refresh with backoff, used for stale-while-revalidate.
  function scheduleBackgroundRefresh(): void {
    if (inflightFetch) return;
    if (now() - lastFetchAttemptAt < REFRESH_BACKOFF_MS) return;
    void fetchFromNetwork();
  }

  async function resolve(): Promise<SimplRuntimeConfig> {
    // (a) memo: fresh → done; stale/fallback → instant value + bg refresh.
    if (isSnapshotFresh()) return snapshot as SimplRuntimeConfig;
    if (snapshot) {
      scheduleBackgroundRefresh();
      return snapshot;
    }
    // (b) storage cache.
    const cached = await readCache();
    if (cached) {
      setSnapshot(cached.config, cached.updatedAt);
      if (!isSnapshotFresh()) scheduleBackgroundRefresh();
      return cached.config;
    }
    // (c) full miss → network.
    const fetched = await fetchFromNetwork();
    if (fetched) return fetched;
    // (d) embedded fallback. snapshotAt stays 0 → always stale, so later calls
    // keep retrying the gateway (with backoff) while serving the fallback.
    const fallback = buildFallbackRuntimeConfig("extension");
    setSnapshot(fallback, 0);
    return fallback;
  }

  async function getRuntimeConfig(): Promise<SimplRuntimeConfig> {
    if (isSnapshotFresh()) return snapshot as SimplRuntimeConfig;
    if (inflightResolve) return inflightResolve;
    inflightResolve = resolve().finally(() => {
      inflightResolve = null;
    });
    return inflightResolve;
  }

  async function refreshRuntimeConfig(force = false): Promise<SimplRuntimeConfig> {
    if (force) {
      const fetched = await fetchFromNetwork();
      if (fetched) return fetched;
    }
    return getRuntimeConfig();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getRuntimeConfig,
    refreshRuntimeConfig,
    getCachedRuntimeConfigSnapshot: () => snapshot,
    subscribe,
  };
}

// ── Default module-level instance ────────────────────────────────────────────

const runtimeConfigService = createRuntimeConfigService();

/** Resolve the runtime config (memo → cache → network → embedded fallback). */
export function getRuntimeConfig(): Promise<SimplRuntimeConfig> {
  return runtimeConfigService.getRuntimeConfig();
}

/** Warm/refresh the runtime config. Fire-and-forget safe; never throws. */
export function refreshRuntimeConfig(force = false): Promise<SimplRuntimeConfig> {
  return runtimeConfigService.refreshRuntimeConfig(force);
}

/**
 * Last resolved runtime config, synchronously — for render-path consumers
 * (logo candidates, feature gates). null until the first resolve completes,
 * which callers must treat as "no remote config yet" (current behavior).
 */
export function getCachedRuntimeConfigSnapshot(): SimplRuntimeConfig | null {
  return runtimeConfigService.getCachedRuntimeConfigSnapshot();
}

/**
 * Subscribe to runtime-config snapshot changes (useSyncExternalStore store).
 * Pair with getCachedRuntimeConfigSnapshot as the getSnapshot; the listener
 * fires whenever the resolved config's identity changes. Returns unsubscribe.
 */
export function subscribeRuntimeConfig(listener: () => void): () => void {
  return runtimeConfigService.subscribe(listener);
}
