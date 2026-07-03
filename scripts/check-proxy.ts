// scripts/check-proxy.ts
//
// Enforces that value-moving / rate-limited providers are proxied in production
// and that no client-side provider secret is used as a production secret.
//
// Run: npm run check:proxy

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { getFeePolicy, feeIsProductionSafe } from "../src/core/trade/fee-policy";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const read = (p: string) => readFileSync(resolve(root, p), "utf8");

console.log("START PROXY / PROVIDER-SECRET CHECK\n");

// ── 0x ───────────────────────────────────────────────────────────────────────
console.log("0x swap routing:");
const zerox = read("src/core/swap/zeroXSwapService.ts");
check(
  "production blocks a direct api.0x.org base URL (throws when no proxy in PROD)",
  /function getZeroXBaseUrl[\s\S]{0,400}import\.meta\.env\.PROD[\s\S]{0,120}throw/.test(zerox),
);
check(
  "the client 0x-api-key path is guarded so it cannot run in production",
  /getZeroXRequestHeaders[\s\S]{0,400}import\.meta\.env\.PROD[\s\S]{0,80}throw/.test(zerox),
);
check(
  "0x-api-key header is only built behind the proxy-absent branch",
  /if \(SIMPL_SWAP_PROXY_URL\)[\s\S]{0,60}return undefined/.test(zerox),
);
check(
  "0x strips any client fee-override params (backend-authoritative)",
  /function stripClientFeeParams[\s\S]{0,240}delete\("swapFeeRecipient"\)[\s\S]{0,120}delete\("swapFeeBps"\)[\s\S]{0,120}delete\("swapFeeToken"\)/.test(
    zerox,
  ),
);
check(
  "0x never sets a swapFee* param on the outgoing request",
  !/searchParams\.set\(\s*["']swapFee/.test(zerox),
);
check(
  "0x price + quote both opt into the v2 normalized response (format=v2)",
  (zerox.match(/set\("format", "v2"\)/g)?.length ?? 0) >= 2,
);

// ── LI.FI bridge ───────────────────────────────────────────────────────────
console.log("\nLI.FI bridge routing:");
const lifi = read("src/core/bridge/lifi-bridge.service.ts");
check(
  "LI.FI base defaults to the Simpl gateway (api.getsimpl.io), never a direct li.fi host",
  /["']https:\/\/api\.getsimpl\.io["']/.test(lifi) && !/li\.fi/i.test(lifi.replace(/\/\/.*$/gm, "")),
);
check(
  "LI.FI integrator/fee/API-key are injected server-side (documented, not client-authoritative)",
  /server-side/i.test(lifi),
);
check(
  "LI.FI quote request body never sends `integrator` or a client `fee`",
  !/integrator\s*:/.test(lifi) && !/\bbody\.fee\s*=/.test(lifi),
);
check(
  "LI.FI quote opts into the v2 normalized response (format=v2)",
  /\/v1\/bridge\/lifi\/quote\?format=v2/.test(lifi),
);
check(
  "LI.FI status polling also requests the v2 shape (format=v2)",
  /set\("format", "v2"\)/.test(lifi),
);

// ── Jupiter / Solana swap ────────────────────────────────────────────────────
console.log("\nSolana swap (Jupiter) routing:");
const jup = read("src/core/swaps/solana-swap.service.ts");
check(
  "Solana swap base defaults to the Simpl gateway",
  /["']https:\/\/api\.getsimpl\.io["']/.test(jup),
);

// ── fee enforcement matrix ───────────────────────────────────────────────────
console.log("\nFee enforcement matrix:");
check(
  "LI.FI bridge fee is backend_authoritative (never client-authoritative)",
  getFeePolicy("lifi", "bridge")?.enforcement === "backend_authoritative",
);
check(
  "0x swap fee is provider_enforced (not client-tamperable)",
  getFeePolicy("zeroex", "swap")?.enforcement === "provider_enforced",
);
check(
  "Pancake fallback carries no simpl fee (not a monetized production route)",
  getFeePolicy("pancake", "swap")?.enforcement === "unsupported" &&
    !feeIsProductionSafe(getFeePolicy("pancake", "swap")!),
);

// ── build-time env secrets ───────────────────────────────────────────────────
console.log("\nProvider secrets:");
check(
  "VITE_0X_API_KEY is only referenced by the dev-fallback 0x path",
  (zerox.match(/VITE_0X_API_KEY/g)?.length ?? 0) > 0 &&
    !read("src/core/bridge/lifi-bridge.service.ts").includes("VITE_0X_API_KEY"),
);

console.log("");
if (failures > 0) {
  console.log(`PROXY / PROVIDER-SECRET CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("PROXY / PROVIDER-SECRET CHECK PASSED");
