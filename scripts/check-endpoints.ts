// scripts/check-endpoints.ts
//
// Scans src/ for external origins (http/https/ws literals) and fails if any
// host is neither in the endpoint inventory (a fetched endpoint) nor in the
// documented NON-FETCH allowlist (block-explorer links + <img> logo CDNs). This
// catches a new production endpoint being added without registering it.
//
// Run: npm run check:endpoints

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

import {
  ENDPOINT_INVENTORY,
  isKnownEndpoint,
  isCustomRpcUrl,
  validateCustomRpcUrl,
} from "../src/core/network/endpoint-inventory";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcRoot = join(root, "src");

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Hosts referenced in src that are intentionally NOT host-permission endpoints:
//   - block explorers: opened as links in a new tab (never fetched)
//   - logo CDNs: loaded via <img> (covered by CSP img-src https:)
const NON_FETCH_ALLOWLIST = new Set<string>([
  "etherscan.io",
  "sepolia.etherscan.io",
  "bscscan.com",
  "basescan.org",
  "tronscan.org",
  "solscan.io",
  "tonviewer.com",
  "mempool.space",
  "assets.trustwalletapp.com",
  "tokens.1inch.io",
]);

// Placeholder / example hosts that may appear in code comments or fee examples.
const IGNORED_HOSTS = new Set<string>(["example.com", "your-rpc.example"]);

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectSources(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const URL_RE = /(?:https?|wss?):\/\/([a-zA-Z0-9._-]+)/g;
const hits = new Map<string, string>(); // host -> first "file:line"

for (const file of collectSources(srcRoot)) {
  const rel = relative(root, file);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(line)) !== null) {
      const host = m[1].toLowerCase();
      if (host.includes("*")) continue;
      if (!hits.has(host)) hits.set(host, `${rel}:${i + 1}`);
    }
  });
}

console.log("START ENDPOINT INVENTORY CHECK\n");
console.log(`Inventory: ${ENDPOINT_INVENTORY.length} registered endpoints.`);
console.log(`Scanned src/: ${hits.size} distinct external hosts referenced.\n`);

const unknown: string[] = [];
for (const [host, where] of hits) {
  if (IGNORED_HOSTS.has(host)) continue;
  const known = isKnownEndpoint(`https://${host}`);
  const nonFetch = NON_FETCH_ALLOWLIST.has(host);
  if (!known && !nonFetch) {
    unknown.push(`${host} (${where})`);
  }
}

check(
  "no unknown external endpoints referenced in src",
  unknown.length === 0,
  unknown.length ? `unregistered: ${unknown.join(", ")}` : undefined,
);

// Every mustUseProxy endpoint must be flagged as such (defensive: keeps the
// proxy policy visible in one place).
const proxyEndpoints = ENDPOINT_INVENTORY.filter((p) => p.mustUseProxy).map((p) => p.id);
check(
  "0x is marked mustUseProxy in the inventory",
  proxyEndpoints.includes("zerox"),
);

// ── custom RPC validation (Stage 5.5) ───────────────────────────────────────
console.log("\nCustom RPC validation:");
check("a known endpoint is NOT a custom RPC", !isCustomRpcUrl("https://api.getsimpl.io/x"));
check("an unknown https host IS a custom RPC", isCustomRpcUrl("https://my-node.example.com"));
check("https custom RPC is valid", validateCustomRpcUrl("https://rpc.mychain.io").valid);
check("http custom RPC is rejected (production)", !validateCustomRpcUrl("http://rpc.mychain.io").valid);
check("http is allowed only with allowInsecure (dev)", validateCustomRpcUrl("http://localhost:8545", { allowInsecure: true }).valid);
check("private 10.x is rejected", !validateCustomRpcUrl("https://10.0.0.5").valid);
check("private 192.168.x is rejected", !validateCustomRpcUrl("https://192.168.1.1").valid);
check("localhost is rejected in production", !validateCustomRpcUrl("https://localhost").valid);
check("garbage URL is rejected", !validateCustomRpcUrl("not a url").valid);

console.log("");
if (failures > 0) {
  console.log(`ENDPOINT INVENTORY CHECK FAILED — ${failures} failing check(s)`);
  console.log("Add the endpoint to src/core/network/endpoint-inventory.ts (or the");
  console.log("NON_FETCH allowlist in this script if it is a link/<img> host).");
  process.exit(1);
}
console.log("ENDPOINT INVENTORY CHECK PASSED");
