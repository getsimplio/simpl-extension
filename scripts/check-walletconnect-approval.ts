// scripts/check-walletconnect-approval.ts
//
// Smoke test for the WalletConnect explicit-approval security model and the
// privacy/manifest hardening. Exercises the pure approval policy
// (src/core/walletconnect/wc-approval-policy.ts) plus static invariants of the
// offscreen engine and the public manifest.
//
// Run: npm run check:walletconnect

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_METHODS,
  HANDLED_REQUEST_METHODS,
  SUPPORTED_METHODS,
  assertEip155ProposalSupported,
  assertTronProposalSupported,
  getApprovedEip155Chains,
  getApprovedEip155Methods,
  isProposalExpired,
  sanitizePeerUrl,
} from "../src/core/walletconnect/wc-approval-policy";

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

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

console.log("START WALLETCONNECT APPROVAL / PRIVACY CHECK\n");

// ── Method allowlist (Stage 2) ─────────────────────────────────────────────
console.log("Method allowlist:");
for (const dangerous of [
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "wallet_addEthereumChain",
  "wallet_sendCalls",
  "wallet_getCallsStatus",
  "wallet_showCallsStatus",
]) {
  check(`excludes ${dangerous}`, !SUPPORTED_METHODS.has(dangerous));
}
for (const safe of [
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_watchAsset",
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_getCapabilities",
]) {
  check(`includes ${safe}`, SUPPORTED_METHODS.has(safe));
}
check("HANDLED_REQUEST_METHODS excludes eth_sign", !HANDLED_REQUEST_METHODS.has("eth_sign"));
check(
  "HANDLED_REQUEST_METHODS excludes wallet_getCapabilities (auto-answered)",
  !HANDLED_REQUEST_METHODS.has("wallet_getCapabilities"),
);

// ── Unsupported REQUIRED chain/method rejected before approval ─────────────
console.log("\nRequired-namespace validation:");
check(
  "unsupported required method → reject",
  throws(() =>
    assertEip155ProposalSupported({
      requiredNamespaces: { eip155: { methods: ["eth_sign"], chains: ["eip155:1"] } },
    }),
  ),
);
check(
  "unsupported required chain → reject",
  throws(() =>
    assertEip155ProposalSupported({
      requiredNamespaces: { eip155: { chains: ["eip155:999999"], methods: ["personal_sign"] } },
    }),
  ),
);
check(
  "supported required chain+method → accepted",
  !throws(() =>
    assertEip155ProposalSupported({
      requiredNamespaces: { eip155: { chains: ["eip155:1"], methods: ["personal_sign"] } },
    }),
  ),
);
check(
  "unsupported required TRON method → reject",
  throws(() =>
    assertTronProposalSupported({
      requiredNamespaces: { tron: { chains: ["tron:0x2b6653dc"], methods: ["tron_evil"] } },
    }),
  ),
);
check(
  "no TRON namespace → TRON validation is a no-op",
  !throws(() => assertTronProposalSupported({ requiredNamespaces: { eip155: {} } })),
);

// ── Optional unsupported filtered, not rejected ────────────────────────────
console.log("\nOptional-namespace filtering:");
const mixed = {
  requiredNamespaces: { eip155: { chains: ["eip155:1"], methods: ["personal_sign"] } },
  optionalNamespaces: {
    eip155: {
      chains: ["eip155:8453", "eip155:999999"],
      methods: ["eth_sendTransaction", "eth_sign", "wallet_sendCalls"],
    },
  },
};
check("optional unsupported does NOT reject", !throws(() => assertEip155ProposalSupported(mixed)));
const approvedMethods = getApprovedEip155Methods(mixed);
check("approved methods exclude eth_sign", !approvedMethods.includes("eth_sign"));
check("approved methods exclude wallet_sendCalls", !approvedMethods.includes("wallet_sendCalls"));
check("approved methods include personal_sign", approvedMethods.includes("personal_sign"));
const approvedChains = getApprovedEip155Chains(mixed);
check("approved chains exclude eip155:999999", !approvedChains.includes("eip155:999999"));
check("approved chains include eip155:1 + eip155:8453",
  approvedChains.includes("eip155:1") && approvedChains.includes("eip155:8453"));

// ── Peer metadata sanitizing ───────────────────────────────────────────────
console.log("\nPeer URL sanitizing:");
check("https URL kept", sanitizePeerUrl("https://app.uniswap.org")?.startsWith("https://") === true);
check("javascript: URL dropped", sanitizePeerUrl("javascript:alert(1)") === undefined);
check("data: URL dropped", sanitizePeerUrl("data:text/html,<b>x</b>") === undefined);
check("empty/undefined dropped", sanitizePeerUrl(undefined) === undefined);

// ── Expiry ──────────────────────────────────────────────────────────────────
console.log("\nProposal expiry:");
check("past expiry → expired", isProposalExpired(1000, 2000 * 1000) === true);
check("future expiry → not expired", isProposalExpired(9_999_999_999, 1000) === false);
check("undefined expiry → not expired", isProposalExpired(undefined, Date.now()) === false);

// ── Static privacy/manifest invariants ─────────────────────────────────────
console.log("\nPrivacy / manifest hardening:");
const offscreenSrc = readFileSync(
  resolve(root, "src/background/walletconnect-offscreen.ts"),
  "utf8",
);
for (const rawKey of [
  "lastWalletConnectProposalRaw",
  "lastWalletConnectProposalDebug",
  "lastWalletConnectTxDebug",
  "lastWalletConnectApprovalResult",
  "lastWalletConnectPairDebug",
  "lastWalletConnectTronRequestDebug",
  "lastWalletConnectAutoResponse",
  "lastWalletConnectWatchedAsset",
]) {
  check(`offscreen no longer writes ${rawKey}`, !offscreenSrc.includes(rawKey));
}
check(
  "offscreen no longer auto-approves in session_proposal",
  !/session_proposal[\s\S]{0,400}approveSession/.test(offscreenSrc),
);
check(
  "offscreen exposes explicit proposal handlers",
  offscreenSrc.includes("SIMPLE_WALLETCONNECT_APPROVE_PROPOSAL") &&
    offscreenSrc.includes("SIMPLE_WALLETCONNECT_REJECT_PROPOSAL") &&
    offscreenSrc.includes("SIMPLE_WALLETCONNECT_GET_PENDING_PROPOSAL"),
);

const manifest = JSON.parse(readFileSync(resolve(root, "public/manifest.json"), "utf8"));
check(
  "manifest: no nativeMessaging permission",
  !(manifest.permissions ?? []).includes("nativeMessaging"),
);

const serviceWorkerSrc = readFileSync(
  resolve(root, "src/background/service-worker.ts"),
  "utf8",
);
check(
  "simpl_switchAccount routes through explicit approval (no direct selectAccount in handler)",
  serviceWorkerSrc.includes('kind: "switch_account"'),
);

console.log("");
if (failures > 0) {
  console.log(`WALLETCONNECT APPROVAL CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("WALLETCONNECT APPROVAL CHECK PASSED");
