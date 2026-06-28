// scripts/check-ton.ts
//
// Unit checks for the TON (Ed25519, smart-contract wallet) adapter that do not
// touch the network: BIP-44 Ed25519 derivation (determinism + uniqueness +
// valid contract address), user-friendly address validation (rejecting EVM /
// Bitcoin / TRON / Solana addresses), nanoton/TON conversion, amount-parse
// guards, and the native portfolio shape. Run with: npm run check:ton

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { deriveTonAccountFromMnemonic, deriveTonAddress } = await import(
  "../src/chains/ton/ton.derivation"
);
const {
  isValidTonAddress,
  normalizeTonAddress,
  shortenTonAddress,
  getTonDerivationPath,
} = await import("../src/chains/ton/ton.address");
const { nanoToTon, tonToNano, formatTonTokenAmount, parseTonTokenAmount } =
  await import("../src/chains/ton/ton.format");
const { TRUSTED_JETTONS, resolveTrustedJetton } = await import(
  "../src/chains/ton/ton.tokens"
);
const { Address } = await import("@ton/core");

let failures = 0;

function ok(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) failures += 1;
}

function throwsCode(label: string, fn: () => unknown, expectedCode: string): void {
  try {
    fn();
    console.log(`FAIL: ${label} (expected throw)`);
    failures += 1;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const codeOk = code === expectedCode;
    console.log(`${codeOk ? "PASS" : "FAIL"}: ${label} (code=${code ?? "none"})`);
    if (!codeOk) failures += 1;
  }
}

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

console.log("=== ton.derivation (BIP-44 Ed25519, v4R2 wallet contract) ===");
const account0 = deriveTonAccountFromMnemonic(MNEMONIC, 0);
const account0Again = deriveTonAccountFromMnemonic(MNEMONIC, 0);
const account1 = deriveTonAccountFromMnemonic(MNEMONIC, 1);

ok(
  "derivation is deterministic for the same mnemonic/index",
  account0.address === account0Again.address,
);
ok(
  "different account index yields a different address",
  account0.address !== account1.address,
);
ok(
  "derivation path is m/44'/607'/0'/0'",
  account0.derivationPath === "m/44'/607'/0'/0'",
);
ok(
  "account 1 path is m/44'/607'/1'/0'",
  account1.derivationPath === "m/44'/607'/1'/0'",
);
ok(
  "getTonDerivationPath(3) is m/44'/607'/3'/0'",
  getTonDerivationPath(3) === "m/44'/607'/3'/0'",
);
ok("derived address is a valid TON address", isValidTonAddress(account0.address));
ok(
  "derived address is the non-bounceable mainnet (UQ…) form",
  account0.address.startsWith("UQ"),
);
ok(
  "publicKey is 32-byte Ed25519 hex (64 chars)",
  /^[0-9a-f]{64}$/.test(account0.publicKey),
);
ok(
  "deriveTonAddress matches the full account address",
  deriveTonAddress(MNEMONIC, 0) === account0.address,
);

console.log("=== ton.address validation ===");
ok("valid UQ… address accepted", isValidTonAddress(account0.address));
ok(
  "raw 0:<hex> address accepted",
  isValidTonAddress(
    "0:0000000000000000000000000000000000000000000000000000000000000000",
  ),
);
ok(
  "EVM 0x address is rejected",
  !isValidTonAddress("0x0000000000000000000000000000000000000000"),
);
ok(
  "Bitcoin bc1 address is rejected",
  !isValidTonAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
);
ok(
  "TRON T-address is rejected",
  !isValidTonAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
);
ok(
  "Solana base58 address is rejected",
  !isValidTonAddress("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"),
);
ok("garbage string is invalid", !isValidTonAddress("not-an-address!!!"));
ok("empty string is invalid", !isValidTonAddress(""));
ok(
  "normalize round-trips a derived address",
  normalizeTonAddress(account0.address) === account0.address,
);
ok(
  "shorten produces an ellipsised form",
  shortenTonAddress(account0.address).includes("…"),
);

console.log("=== ton.format conversion (9 decimals) ===");
ok("tonToNano('1') === 1000000000n", tonToNano("1") === 1_000_000_000n);
ok("tonToNano('0.000000001') === 1n", tonToNano("0.000000001") === 1n);
ok("nanoToTon(1000000000n) === '1'", nanoToTon(1_000_000_000n) === "1");
ok("nanoToTon(12300n) === '0.0000123'", nanoToTon(12_300n) === "0.0000123");
ok(
  "roundtrip tonToNano/nanoToTon('0.25')",
  nanoToTon(tonToNano("0.25")) === "0.25",
);
ok(
  "formatTonTokenAmount(1500000n, 6) === '1.5'",
  formatTonTokenAmount(1_500_000n, 6) === "1.5",
);
ok(
  "parseTonTokenAmount('1.5', 6) === 1500000n",
  parseTonTokenAmount("1.5", 6) === 1_500_000n,
);
throwsCode(
  "tonToNano rejects 10 decimals",
  () => tonToNano("0.0000000001"),
  "TON_INVALID_AMOUNT",
);
throwsCode("tonToNano rejects zero", () => tonToNano("0"), "TON_INVALID_AMOUNT");
throwsCode(
  "tonToNano rejects non-numeric",
  () => tonToNano("abc"),
  "TON_INVALID_AMOUNT",
);

console.log("=== ton.tokens trusted Jetton registry ===");
ok(
  "registry contains USDT, NOT, DOGS",
  ["USDT", "NOT", "DOGS"].every((s) =>
    TRUSTED_JETTONS.some((j) => j.symbol === s),
  ),
);
ok("USDT has 6 decimals", TRUSTED_JETTONS.find((j) => j.symbol === "USDT")?.decimals === 6);
ok("NOT has 9 decimals", TRUSTED_JETTONS.find((j) => j.symbol === "NOT")?.decimals === 9);
ok("DOGS has 9 decimals", TRUSTED_JETTONS.find((j) => j.symbol === "DOGS")?.decimals === 9);
ok(
  "every registry master is a valid TON address",
  TRUSTED_JETTONS.every((j) => isValidTonAddress(j.master)),
);

const usdtMaster = TRUSTED_JETTONS.find((j) => j.symbol === "USDT")!.master;
ok(
  "resolveTrustedJetton matches the canonical EQ master",
  resolveTrustedJetton(usdtMaster)?.symbol === "USDT",
);
ok(
  "resolveTrustedJetton matches the raw (0:hex) master form",
  resolveTrustedJetton(Address.parse(usdtMaster).toRawString())?.symbol === "USDT",
);
ok(
  "resolveTrustedJetton matches the non-bounceable (UQ…) master form",
  resolveTrustedJetton(
    Address.parse(usdtMaster).toString({ urlSafe: true, bounceable: false }),
  )?.symbol === "USDT",
);
ok(
  "resolveTrustedJetton rejects an unknown jetton master",
  resolveTrustedJetton(
    "0:0000000000000000000000000000000000000000000000000000000000000000",
  ) === null,
);
ok(
  "resolveTrustedJetton rejects a non-TON address (spam guard)",
  resolveTrustedJetton("0x0000000000000000000000000000000000000000") === null,
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All TON checks passed.");
