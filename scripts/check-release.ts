// scripts/check-release.ts
//
// Enterprise release gate. Runs the full set of pre-release checks in order and
// fails fast. Lightweight: shells out to the existing npm scripts / build, no
// test framework. Run: npm run check:release
//
// Order is cheap-first so fast regressions surface before the ~build step:
//   typecheck → i18n → WC approval → privacy → manifest → dApp perms →
//   security → production build.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

type Step = { name: string; cmd: string };

const steps: Step[] = [
  { name: "TypeScript typecheck", cmd: "npm run --silent typecheck" },
  { name: "i18n key parity", cmd: "npm run --silent check:i18n" },
  { name: "WalletConnect approval model", cmd: "npm run --silent check:walletconnect" },
  { name: "Connected-site permission model", cmd: "npm run --silent check:permissions" },
  { name: "Backup / risk policy", cmd: "npm run --silent check:risk" },
  { name: "Endpoint inventory", cmd: "npm run --silent check:endpoints" },
  { name: "Proxy / provider secrets", cmd: "npm run --silent check:proxy" },
  { name: "Privacy / storage / logs", cmd: "npm run --silent check:privacy" },
  { name: "Manifest release validation", cmd: "npm run --silent check:manifest" },
  { name: "dApp permission regression", cmd: "npm run --silent check:dapp" },
  { name: "Security smoke", cmd: "npm run --silent check:security" },
  { name: "Production build", cmd: "npm run --silent build" },
];

console.log("========================================");
console.log(" SIMPL RELEASE GATE — npm run check:release");
console.log("========================================\n");

const results: { name: string; ok: boolean }[] = [];

for (const step of steps) {
  console.log(`\n▶ ${step.name}\n${"-".repeat(40)}`);
  try {
    execSync(step.cmd, { cwd: root, stdio: "inherit" });
    results.push({ name: step.name, ok: true });
  } catch {
    results.push({ name: step.name, ok: false });
    console.log(`\n✗ FAILED: ${step.name}`);
    // Fail fast — a broken gate makes later steps meaningless.
    break;
  }
}

console.log("\n========================================");
console.log(" RELEASE GATE SUMMARY");
console.log("========================================");
for (const step of steps) {
  const r = results.find((x) => x.name === step.name);
  const mark = !r ? "•" : r.ok ? "✓" : "✗";
  const status = !r ? "skipped" : r.ok ? "passed" : "FAILED";
  console.log(`  ${mark} ${step.name} — ${status}`);
}

const failed = results.some((r) => !r.ok);
console.log("");
if (failed) {
  console.log("RELEASE GATE FAILED — fix the failing step above before releasing.");
  process.exit(1);
}
console.log("RELEASE GATE PASSED — all pre-release checks green.");
