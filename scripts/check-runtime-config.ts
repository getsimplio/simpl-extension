// scripts/check-runtime-config.ts
//
// Runtime-config release gate. Verifies the Stage-1 guarantees of
// src/core/config/runtime-config.service.ts without any network or chrome API:
//   1. the embedded fallback (buildFallbackRuntimeConfig) is a valid, usable
//      config describing the wallet as shipped today,
//   2. a successful gateway fetch is returned AND persisted to storage,
//   3. a dead gateway with an empty cache falls back to the embedded config,
//   4. the Swap/Bridge remote feature gate fails OPEN on fallback and obeys
//      server flags otherwise.
// chrome.storage is mocked with the MemoryStorageAdapter, fetch is injected.
//
// Run: npm run check:runtime-config

import {
  buildFallbackRuntimeConfig,
  normalizeRuntimeConfig,
  type SimplRuntimeConfig,
} from "@getsimpl/config";
import { MemoryStorageAdapter } from "../src/core/storage/storage.repository";
import {
  createRuntimeConfigService,
  RUNTIME_CONFIG_STORAGE_KEY,
} from "../src/core/config/runtime-config.service";
import { isRemoteFeatureEnabledFor } from "../src/core/config/feature-gate";
import { resolveVisibleChains } from "../src/core/networks/chain-visibility";
import { BASE_CHAIN_ID, DEFAULT_CHAINS } from "../src/core/networks/chain-registry";

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// A wire-shaped server config: the embedded fallback re-labelled as a published
// server snapshot with swaps turned OFF (JSON round-trip = untrusted payload).
function buildServerConfig(): SimplRuntimeConfig {
  const config = buildFallbackRuntimeConfig("extension");
  const server: SimplRuntimeConfig = {
    ...config,
    version: "v7",
    features: { ...config.features, swaps: false },
    meta: { ...config.meta, source: "db", publishedVersionId: "ver-7" },
  };
  return JSON.parse(JSON.stringify(server)) as SimplRuntimeConfig;
}

function okFetch(payload: unknown): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ ok: true, data: payload }),
  })) as unknown as typeof fetch;
}

const failingFetch: typeof fetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

console.log("START RUNTIME CONFIG CHECK\n");

// ── 1. Embedded fallback is valid and complete ───────────────────────────────
console.log("Embedded fallback config:");
const fallback = buildFallbackRuntimeConfig("extension");
check(
  "fallback passes normalizeRuntimeConfig",
  normalizeRuntimeConfig(JSON.parse(JSON.stringify(fallback))) !== null,
);
check(
  `fallback has >= 7 chains (got ${fallback.chains.length})`,
  fallback.chains.length >= 7,
);
check(
  `fallback has >= 10 assets (got ${fallback.assets.length})`,
  fallback.assets.length >= 10,
);
check('fallback meta.source is "fallback"', fallback.meta.source === "fallback");
check('fallback meta.app is "extension"', fallback.meta.app === "extension");
check(
  "fallback enables swaps + bridge (current behavior)",
  fallback.features.swaps === true && fallback.features.bridge === true,
);

// ── 2. Successful fetch is returned and cached ───────────────────────────────
console.log("\nGateway fetch success path:");
const serverConfig = buildServerConfig();
const storage = new MemoryStorageAdapter();
const service = createRuntimeConfigService({
  storage,
  fetchImpl: okFetch(serverConfig),
});

check("snapshot is null before first resolve", service.getCachedRuntimeConfigSnapshot() === null);

const resolved = await service.getRuntimeConfig();
check(
  "returns the server config (version + source)",
  resolved.version === "v7" && resolved.meta.source === "db",
  `got version=${resolved.version} source=${resolved.meta.source}`,
);
check("server flag survives normalization (swaps=false)", resolved.features.swaps === false);
check(
  "snapshot is available synchronously after resolve",
  service.getCachedRuntimeConfigSnapshot()?.version === "v7",
);

const stored = await storage.get([RUNTIME_CONFIG_STORAGE_KEY]);
const envelope = stored[RUNTIME_CONFIG_STORAGE_KEY] as
  | { config?: { version?: string }; updatedAt?: number }
  | undefined;
check(
  `config is cached in storage under ${RUNTIME_CONFIG_STORAGE_KEY}`,
  envelope?.config?.version === "v7",
);
check(
  "cache envelope carries a numeric updatedAt",
  typeof envelope?.updatedAt === "number" && Number.isFinite(envelope.updatedAt),
);

// A NEW service instance over the same storage must serve the cache even with
// a dead gateway (fresh cache → no network dependency).
const cachedService = createRuntimeConfigService({
  storage,
  fetchImpl: failingFetch,
});
const fromCache = await cachedService.getRuntimeConfig();
check(
  "fresh cache is served without the network",
  fromCache.version === "v7" && fromCache.meta.source === "db",
);

// ── 3. Dead gateway + empty cache → embedded fallback ────────────────────────
console.log("\nGateway failure path:");
const offlineService = createRuntimeConfigService({
  storage: new MemoryStorageAdapter(),
  fetchImpl: failingFetch,
});
const offline = await offlineService.getRuntimeConfig();
check(
  'failing fetch + empty cache resolves the fallback (meta.source === "fallback")',
  offline.meta.source === "fallback",
  `got source=${offline.meta.source}`,
);
check(
  "fallback resolve never leaves the wallet without chains/assets",
  offline.chains.length >= 7 && offline.assets.length >= 10,
);
const offlineRefreshed = await offlineService.refreshRuntimeConfig(true);
check(
  "forced refresh on a dead gateway still resolves (never throws)",
  offlineRefreshed.meta.source === "fallback",
);

// ── 4. Remote feature gate (Swap/Bridge buttons) ─────────────────────────────
console.log("\nRemote feature gate:");
check("no snapshot yet → enabled (fail-open)", isRemoteFeatureEnabledFor(null, "swaps") === true);
check(
  "embedded fallback → enabled (fail-open)",
  isRemoteFeatureEnabledFor(fallback, "swaps") === true &&
    isRemoteFeatureEnabledFor(fallback, "bridge") === true,
);
check(
  "server config with swaps=false → disabled",
  isRemoteFeatureEnabledFor(resolved, "swaps") === false,
);
check(
  "server config keeps bridge enabled (flag true)",
  isRemoteFeatureEnabledFor(resolved, "bridge") === true,
);
const noFlags = {
  ...resolved,
  features: {} as SimplRuntimeConfig["features"],
};
check(
  "server config missing a flag → enabled (existing-surface default)",
  isRemoteFeatureEnabledFor(noFlags, "swaps") === true,
);

// ── 5. Chain visibility (Stage 2 network selector) ───────────────────────────
console.log("\nChain visibility (resolveVisibleChains):");

const LOCAL_MAINNETS = DEFAULT_CHAINS.filter((c) => !c.isTestnet);
const LOCAL_TESTNETS = DEFAULT_CHAINS.filter((c) => c.isTestnet);
const LOCAL_RPCS = new Set(DEFAULT_CHAINS.map((c) => c.rpcUrl));

// No server opinion → full local registry, unchanged (today's behavior).
check(
  "null config → full local registry unchanged",
  resolveVisibleChains(null).length === DEFAULT_CHAINS.length,
);
check(
  "embedded fallback config → full local registry unchanged",
  resolveVisibleChains(fallback).length === DEFAULT_CHAINS.length,
);

// A server (db) config listing all mainnets → all mainnets visible, local
// testnets appended (server never lists testnets for the extension).
const serverAll = buildServerConfig(); // 7 mainnet chains, source=db
const visAll = resolveVisibleChains(serverAll);
check(
  "server config → mainnets + local testnets",
  visAll.filter((c) => !c.isTestnet).length === LOCAL_MAINNETS.length &&
    visAll.filter((c) => c.isTestnet).length === LOCAL_TESTNETS.length,
  `mainnets=${visAll.filter((c) => !c.isTestnet).length} testnets=${visAll.filter((c) => c.isTestnet).length}`,
);
check(
  "every visible chain is a LOCAL registry entry (no config rpcUrl ever leaks)",
  visAll.every((c) => LOCAL_RPCS.has(c.rpcUrl) && DEFAULT_CHAINS.includes(c)),
);

// Hiding a mainnet: drop Base from the server config → Base disappears.
const serverHideBase: SimplRuntimeConfig = {
  ...serverAll,
  chains: serverAll.chains.filter((c) => c.chainId !== BASE_CHAIN_ID),
};
const visHidden = resolveVisibleChains(serverHideBase);
check(
  "server hides Base → Base not shown",
  !visHidden.some((c) => c.chainId === BASE_CHAIN_ID),
);

// ...but the ACTIVE chain is always kept visible, even when hidden.
const visHiddenSelected = resolveVisibleChains(serverHideBase, BASE_CHAIN_ID);
check(
  "hidden Base is re-shown when it is the active chain (never strand the user)",
  visHiddenSelected.some((c) => c.chainId === BASE_CHAIN_ID),
);

// Reordering: reverse the server mainnet order → output mainnet order follows.
const serverReordered: SimplRuntimeConfig = {
  ...serverAll,
  chains: [...serverAll.chains].reverse(),
};
const visReordered = resolveVisibleChains(serverReordered).filter((c) => !c.isTestnet);
const expectedOrder = [...serverAll.chains].reverse().map((c) => c.chainId);
check(
  "mainnet order follows the server config order",
  visReordered.map((c) => c.chainId).join(",") === expectedOrder.join(","),
  `got ${visReordered.map((c) => c.chainId).join(",")}`,
);

// An empty/degenerate server config never yields an empty selector.
const serverEmpty: SimplRuntimeConfig = { ...serverAll, chains: [] };
check(
  "server config with zero chains → falls back to full local registry",
  resolveVisibleChains(serverEmpty).length === DEFAULT_CHAINS.length,
);

console.log("");
if (failures > 0) {
  console.log(`RUNTIME CONFIG CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("RUNTIME CONFIG CHECK PASSED");
