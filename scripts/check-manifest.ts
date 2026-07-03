// scripts/check-manifest.ts
//
// Manifest release validation. Fails (exit 1) if the public manifest regresses
// on least-privilege:
//   - host_permissions must NOT contain <all_urls> (must be an explicit allowlist),
//   - nativeMessaging must be absent unless a native host is shipped + documented,
//   - content_scripts <all_urls>/http/https is allowed (provider injection) but a
//     justification doc must exist,
//   - the endpoint inventory doc must exist.
//
// Run: npm run check:manifest

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { getAllowedHostPermissions } from "../src/core/network/endpoint-inventory";

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

console.log("START MANIFEST RELEASE VALIDATION\n");

const manifest = JSON.parse(readFileSync(resolve(root, "public/manifest.json"), "utf8"));

// ── permissions ─────────────────────────────────────────────────────────────
console.log("permissions:");
const permissions: string[] = manifest.permissions ?? [];
// nativeMessaging is only justifiable if a native host is actually shipped.
const hasNativeHostCode = existsSync(resolve(root, "src/core/native"));
check(
  "nativeMessaging absent (no native host is shipped)",
  !permissions.includes("nativeMessaging") || hasNativeHostCode,
  permissions.includes("nativeMessaging")
    ? "nativeMessaging present but no src/core/native host exists"
    : undefined,
);

// ── host_permissions ─────────────────────────────────────────────────────────
console.log("\nhost_permissions:");
const hostPerms: string[] = manifest.host_permissions ?? [];
check("does NOT contain <all_urls>", !hostPerms.includes("<all_urls>"));
check("is a bounded explicit allowlist", hostPerms.length > 0 && hostPerms.length < 40);
check(
  "every entry is a concrete https host (no scheme wildcard *://*)",
  hostPerms.every((h) => h.startsWith("https://") && !h.startsWith("https://*/")),
  hostPerms.filter((h) => !h.startsWith("https://") || h.startsWith("https://*/")).join(", "),
);
// The endpoints the wallet cannot function without.
for (const required of [
  "https://api.getsimpl.io/*",
  "https://api.trongrid.io/*",
  "https://blockstream.info/*",
  "https://api.mainnet-beta.solana.com/*",
  "https://ethereum-rpc.publicnode.com/*",
]) {
  check(`includes ${required}`, hostPerms.includes(required));
}
// Dead hosts that were removed must not creep back.
for (const dead of [
  "https://api.coingecko.com/*",
  "https://binance.llamarpc.com/*",
  "https://bsc-dataseed.binance.org/*",
]) {
  check(`no dead host ${dead}`, !hostPerms.includes(dead));
}

// host_permissions must EXACTLY equal the endpoint inventory's derived set — the
// registry (src/core/network/endpoint-inventory.ts) is the single source of truth.
const expected = getAllowedHostPermissions();
const actualSorted = [...hostPerms].sort();
const missingFromManifest = expected.filter((h) => !hostPerms.includes(h));
const extraInManifest = actualSorted.filter((h) => !expected.includes(h));
check(
  "host_permissions exactly matches the endpoint inventory",
  missingFromManifest.length === 0 && extraInManifest.length === 0,
  [
    missingFromManifest.length ? `missing: ${missingFromManifest.join(", ")}` : "",
    extraInManifest.length ? `unregistered: ${extraInManifest.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" | "),
);

// ── optional_host_permissions ────────────────────────────────────────────────
console.log("\noptional_host_permissions:");
check(
  "custom/broad host access is optional (runtime-requested, not a default grant)",
  Array.isArray(manifest.optional_host_permissions) &&
    manifest.optional_host_permissions.length > 0,
);

// ── content_scripts ───────────────────────────────────────────────────────────
console.log("\ncontent_scripts:");
const contentMatches: string[] = (manifest.content_scripts ?? []).flatMap(
  (cs: { matches?: string[] }) => cs.matches ?? [],
);
check("content scripts are declared", contentMatches.length > 0);
// Provider injection legitimately needs broad matches. <all_urls> OR http/https
// are both acceptable; anything else is unexpected.
const allowedMatchers = new Set(["<all_urls>", "http://*/*", "https://*/*"]);
check(
  "content_scripts matches are provider-injection scope only",
  contentMatches.every((m) => allowedMatchers.has(m)),
  contentMatches.filter((m) => !allowedMatchers.has(m)).join(", "),
);

// ── documentation must exist (permission + endpoint justification for CWS) ────
console.log("\ndocumentation:");
for (const doc of [
  "docs/chrome-store-permissions.md",
  "docs/endpoint-inventory.md",
]) {
  check(`${doc} exists`, existsSync(resolve(root, doc)));
}
// The permissions doc must justify the content_scripts broad match.
const permDoc = existsSync(resolve(root, "docs/chrome-store-permissions.md"))
  ? readFileSync(resolve(root, "docs/chrome-store-permissions.md"), "utf8")
  : "";
check(
  "chrome-store-permissions.md justifies broad content_scripts match",
  /content_scripts/i.test(permDoc) && /(provider|inject)/i.test(permDoc),
);

console.log("");
if (failures > 0) {
  console.log(`MANIFEST VALIDATION FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("MANIFEST VALIDATION PASSED");
