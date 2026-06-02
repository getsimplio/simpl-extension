// scripts/check-tron.ts
//
// Unit checks for the TRON transaction layer that do not touch the network:
// amount conversion, address validation, error normalization, and the
// pre-broadcast guards in the signer flow. Run with: npm run check:tron

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { trxToSun, sunToTrx, toBaseUnits } = await import(
  "../src/chains/tron/tron.format"
);
const { isValidTronAddress, deriveTronAccount } = await import(
  "../src/chains/tron/tron.address"
);
const { normalizeTronError, decodeHexMessage } = await import(
  "../src/chains/tron/tron.errors"
);
const { sendTrx } = await import("../src/chains/tron/tron.transactions");
const { signTronMessage } = await import("../src/chains/tron/tron.signer");
const { getTronWeb } = await import("../src/chains/tron/tron.balance");
const { extractTronWcTransaction, extractTronWcMessage } = await import(
  "../src/chains/tron/tron.wc"
);

let failures = 0;

function ok(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) failures += 1;
}

function throws(label: string, fn: () => unknown, expectedCode?: string): void {
  try {
    fn();
    console.log(`FAIL: ${label} (expected throw)`);
    failures += 1;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const codeOk = !expectedCode || code === expectedCode;
    console.log(
      `${codeOk ? "PASS" : "FAIL"}: ${label} (code=${code ?? "none"})`,
    );
    if (!codeOk) failures += 1;
  }
}

async function rejects(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await fn();
    console.log(`FAIL: ${label} (expected rejection)`);
    failures += 1;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const codeOk = code === expectedCode;
    console.log(`${codeOk ? "PASS" : "FAIL"}: ${label} (code=${code ?? "none"})`);
    if (!codeOk) failures += 1;
  }
}

// A real, valid base58 TRON address (the USDT TRC-20 contract address).
const VALID_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

console.log("=== tron.format ===");
ok("trxToSun('1') === 1000000n", trxToSun("1") === 1_000_000n);
ok("trxToSun('0.000001') === 1n", trxToSun("0.000001") === 1n);
ok("sunToTrx(1000000n) === '1.0'", sunToTrx(1_000_000n) === "1.0");
throws("trxToSun('0.0000001') throws (7 decimals)", () => trxToSun("0.0000001"), "INVALID_AMOUNT");
throws("trxToSun('0') throws (not positive)", () => trxToSun("0"), "INVALID_AMOUNT");
throws("trxToSun('abc') throws (malformed)", () => trxToSun("abc"), "INVALID_AMOUNT");
ok("toBaseUnits('1.5', 6) === 1500000n", toBaseUnits("1.5", 6) === 1_500_000n);

console.log("\n=== tron.address ===");
ok("valid TRON address accepted", isValidTronAddress(VALID_TRON_ADDRESS));
ok("EVM address rejected", !isValidTronAddress("0x0000000000000000000000000000000000000000"));
ok("garbage rejected", !isValidTronAddress("not-an-address"));

console.log("\n=== tron.errors ===");
ok("decodeHexMessage decodes 'Hello'", decodeHexMessage("48656c6c6f") === "Hello");
ok(
  "decodeHexMessage decodes 0x-prefixed",
  decodeHexMessage("0x48656c6c6f") === "Hello",
);
ok(
  "decodeHexMessage leaves normal text untouched",
  decodeHexMessage("balance is not sufficient") === "balance is not sufficient",
);
ok(
  "insufficient balance -> INSUFFICIENT_TRX_BALANCE",
  normalizeTronError({ message: "balance is not sufficient" }).code ===
    "INSUFFICIENT_TRX_BALANCE",
);
ok(
  "invalid address -> INVALID_TRON_ADDRESS",
  normalizeTronError({ message: "Invalid address provided" }).code ===
    "INVALID_TRON_ADDRESS",
);
ok(
  "network timeout -> TRON_NETWORK_ERROR",
  normalizeTronError(new Error("request timeout")).code === "TRON_NETWORK_ERROR",
);
ok(
  "coded error passes through unchanged",
  normalizeTronError(
    normalizeTronError({ message: "balance is not sufficient" }),
  ).code === "INSUFFICIENT_TRX_BALANCE",
);

console.log("\n=== tron.signer (pre-network guards) ===");
// Build/sign/broadcast guards reject before any network call.
await rejects(
  "sendTrx rejects invalid recipient",
  () =>
    sendTrx({
      privateKey: "0".repeat(64),
      fromAddress: VALID_TRON_ADDRESS,
      toAddress: "not-a-tron-address",
      amountSun: 1_000_000n,
    }),
  "INVALID_TRON_ADDRESS",
);
await rejects(
  "sendTrx rejects non-positive amount",
  () =>
    sendTrx({
      privateKey: "0".repeat(64),
      fromAddress: VALID_TRON_ADDRESS,
      toAddress: VALID_TRON_ADDRESS,
      amountSun: 0n,
    }),
  "INVALID_AMOUNT",
);

console.log("\n=== tron.wc (WalletConnect payload normalization) ===");
const SAMPLE_TX = { txID: "abc123", raw_data: {}, raw_data_hex: "00" };
ok(
  "extractTronWcTransaction unwraps { transaction }",
  extractTronWcTransaction({ transaction: SAMPLE_TX }).txID === "abc123",
);
ok(
  "extractTronWcTransaction unwraps [tx]",
  extractTronWcTransaction([SAMPLE_TX]).txID === "abc123",
);
ok(
  "extractTronWcTransaction passes through a bare tx",
  extractTronWcTransaction(SAMPLE_TX).txID === "abc123",
);
throws(
  "extractTronWcTransaction rejects tx without txID",
  () => extractTronWcTransaction({ raw_data: {} }),
  "INVALID_TRON_PAYLOAD",
);
throws(
  "extractTronWcTransaction rejects non-object",
  () => extractTronWcTransaction("nope"),
  "INVALID_TRON_PAYLOAD",
);
ok(
  "extractTronWcMessage reads a bare string",
  extractTronWcMessage("hello") === "hello",
);
ok(
  "extractTronWcMessage reads { message }",
  extractTronWcMessage({ message: "hi" }) === "hi",
);
ok(
  "extractTronWcMessage reads [message]",
  extractTronWcMessage(["yo"]) === "yo",
);
throws(
  "extractTronWcMessage rejects empty/invalid",
  () => extractTronWcMessage({ foo: 1 }),
  "INVALID_TRON_PAYLOAD",
);

console.log("\n=== tron.signer message signing (local ECDSA, no network) ===");
// Standard ethers test mnemonic — derive a real TRON key locally.
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const tronAccount = deriveTronAccount(TEST_MNEMONIC, 0);
const signature = signTronMessage("Hello SIMPL", tronAccount.privateKey);
ok(
  "signTronMessage returns a 65-byte 0x hex signature",
  /^0x[0-9a-fA-F]{130}$/.test(signature),
);
const recovered = await getTronWeb().trx.verifyMessageV2("Hello SIMPL", signature);
ok(
  "signTronMessage signature verifies back to the signer address",
  recovered === tronAccount.address,
);
throws(
  "signTronMessage rejects a malformed private key",
  () => signTronMessage("x", "not-a-key"),
  "TRON_SIGN_FAILED",
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All TRON checks passed.");
