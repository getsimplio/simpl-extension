// scripts/check-dapp-permissions.ts
//
// dApp permission regression gate. Static checks that a connected dApp cannot
// silently change wallet-global state or sign after revoke:
//   - simpl_switchAccount / simpl_setActiveAccount route through explicit
//     approval (no inline selectAccount in the request handler),
//   - simpl_switchChain is connection-guarded + approval-gated,
//   - the active account is only changed inside the approval handler,
//   - sensitive dApp methods are connection-guarded,
//   - revoke removes the origin from connectedSites (which gates every method).
//
// Run: npm run check:dapp

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sw = readFileSync(resolve(root, "src/background/service-worker.ts"), "utf8");

// Extract the `{ ... }` body of a `case "<method>":` block via brace matching.
// Handles stacked fall-through labels (e.g. `case "a":\n case "b": { ... }`) by
// starting at the first `{` after the label and matching to its close.
function caseSlice(method: string): string {
  const label = sw.indexOf(`case "${method}"`);
  if (label === -1) return "";
  const open = sw.indexOf("{", label);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < sw.length; i += 1) {
    if (sw[i] === "{") depth += 1;
    else if (sw[i] === "}") {
      depth -= 1;
      if (depth === 0) return sw.slice(label, i + 1);
    }
  }
  return sw.slice(label, label + 4000);
}

console.log("START dApp PERMISSION REGRESSION CHECK\n");

// ── simpl_switchAccount: must NOT switch silently ───────────────────────────
console.log("simpl_switchAccount / simpl_setActiveAccount:");
const switchAcctSlice = caseSlice("simpl_switchAccount");
check("handler exists", switchAcctSlice.length > 0);
check(
  "routes through explicit approval (kind: switch_account)",
  /kind:\s*"switch_account"/.test(switchAcctSlice),
);
check(
  "does NOT call walletService.selectAccount inline in the request handler",
  !/walletService\.selectAccount/.test(switchAcctSlice),
);
check(
  "connection-guarded (getDappConnectionForOrigin)",
  /getDappConnectionForOrigin/.test(switchAcctSlice),
);
// The active account may only change inside the approval handler.
const approveHandlerIdx = sw.indexOf("SIMPL_DAPP_APPROVE");
check(
  "selectAccount is only reachable via the SIMPL_DAPP_APPROVE handler",
  approveHandlerIdx !== -1 &&
    sw.indexOf("walletService.selectAccount") > approveHandlerIdx,
);

// ── simpl_switchChain: connection + approval gated (if present in mainline) ──
console.log("\nsimpl_switchChain:");
const switchChainSlice = caseSlice("simpl_switchChain");
if (switchChainSlice.length === 0) {
  check("not in mainline — nothing to guard", true);
} else {
  check("connection-guarded (getDappConnectionForOrigin)", /getDappConnectionForOrigin/.test(switchChainSlice));
  check("approval-gated (kind: switch_chain + openDappApprovalWindow)",
    /kind:\s*"switch_chain"/.test(switchChainSlice) && /openDappApprovalWindow/.test(switchChainSlice));
  check("does NOT call setSelectedChainId inline in the request handler",
    !/walletService\.setSelectedChainId/.test(switchChainSlice));
}

// ── sensitive methods are connection-guarded ────────────────────────────────
console.log("\nSensitive dApp methods are connection-guarded:");
for (const method of ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "simpl_getAccounts"]) {
  const slice = caseSlice(method);
  check(`${method} checks getDappConnectionForOrigin`, /getDappConnectionForOrigin/.test(slice));
}

// ── revoke removes access ────────────────────────────────────────────────────
console.log("\nRevoke:");
check(
  "getDappConnectionForOrigin gates on the connectedSites store",
  /function getDappConnectionForOrigin[\s\S]{0,300}connectedSites/.test(sw),
);
const connectedSitesPagePath = resolve(root, "src/popup/routes/ConnectedSitesPage.tsx");
check("ConnectedSitesPage exists", existsSync(connectedSitesPagePath));
if (existsSync(connectedSitesPagePath)) {
  const page = readFileSync(connectedSitesPagePath, "utf8");
  check(
    "disconnectSite removes the origin from connectedSites",
    /disconnectSite[\s\S]{0,200}filter\(/.test(page),
  );
  check("disconnectAll clears connections", /disconnectAll/.test(page));
}

console.log("");
if (failures > 0) {
  console.log(`dApp PERMISSION CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("dApp PERMISSION CHECK PASSED");
