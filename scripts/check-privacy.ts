// scripts/check-privacy.ts
//
// Privacy / storage / logging release gate. Fails (exit 1) if a regression
// re-introduces:
//   - raw WalletConnect proposal/request payloads written to chrome.storage,
//   - any *_DEBUG flag hard-enabled in production (must be gated on
//     import.meta.env.DEV),
//   - console logging of secrets (seed / mnemonic / private key / password).
//
// Static source scan — no runtime. Run: npm run check:privacy

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcRoot = join(root, "src");

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Collect every .ts / .tsx file under src/.
function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSources(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectSources(srcRoot);
const sources = files.map((f) => ({ path: f, rel: relative(root, f), text: readFileSync(f, "utf8") }));

function findMatches(pattern: RegExp): { rel: string; line: number; text: string }[] {
  const hits: { rel: string; line: number; text: string }[] = [];
  for (const { rel, text } of sources) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push({ rel, line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

console.log("START PRIVACY / STORAGE / LOG CHECK\n");

// ── 1. No raw/debug WalletConnect payload storage keys anywhere ─────────────
console.log("Raw WalletConnect payload storage keys (must be absent):");
const forbiddenKeys = [
  "lastWalletConnectProposalRaw",
  "lastWalletConnectRequestRaw",
  "lastWalletConnectProposalDebug",
  "lastWalletConnectTxDebug",
  "lastWalletConnectApprovalResult",
  "lastWalletConnectPairDebug",
  "lastWalletConnectTronRequestDebug",
  "lastWalletConnectAutoResponse",
  "lastWalletConnectWatchedAsset",
  "lastWalletConnectNetworkAwareSwitch",
  "lastWalletConnectSelectedChainSwitch",
];
for (const key of forbiddenKeys) {
  const hits = findMatches(new RegExp(`\\b${key}\\b`));
  check(
    `no writes of ${key}`,
    hits.length === 0,
    hits.map((h) => `${h.rel}:${h.line}`).join(", "),
  );
}

// ── 2. Debug flags must be env-gated, never hard-enabled ────────────────────
console.log("\nDebug flags gated on dev build:");
const hardDebug = findMatches(/\b[A-Z_]*DEBUG[A-Z_]*\s*=\s*true\b/);
check(
  "no `*_DEBUG = true` hard-enabled flags",
  hardDebug.length === 0,
  hardDebug.map((h) => `${h.rel}:${h.line} (${h.text})`).join(" | "),
);
// The balance diagnostics flag specifically must be dev-gated.
const homePage = sources.find((s) => s.rel.endsWith("HomePage.tsx"));
check(
  "HomePage BALANCE_DEBUG is import.meta.env.DEV",
  !!homePage && /const\s+BALANCE_DEBUG\s*=\s*import\.meta\.env\.DEV/.test(homePage.text),
);

// ── 3. Secrets must never be logged ─────────────────────────────────────────
console.log("\nNo console logging of secrets:");
// console.<method>( ... <secret token> ... ) on a single line.
const secretLog = findMatches(
  /console\.(log|info|warn|error|debug)\([^)]*\b(mnemonic|seedPhrase|privateKey|private_key|secretKey|password)\b/i,
);
check(
  "no console logs referencing mnemonic/privateKey/password/etc.",
  secretLog.length === 0,
  secretLog.map((h) => `${h.rel}:${h.line}`).join(", "),
);

console.log("");
if (failures > 0) {
  console.log(`PRIVACY CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("PRIVACY CHECK PASSED");
