// scripts/check-derivation.ts

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
  });
}

const { mnemonicService } = await import(
  "../src/core/mnemonic/mnemonic.service"
);

const { deriveEvmAccount, deriveManyEvmAccounts } = await import(
  "../src/core/accounts/derivation"
);

const mnemonic = mnemonicService.generateMnemonic({ wordCount: 12 });

console.log("DEMO MNEMONIC:");
console.log(mnemonic);
console.log("");

const accounts = deriveManyEvmAccounts(mnemonic, 3);

console.log("DERIVED ACCOUNTS:");

for (const account of accounts) {
  console.log({
    index: account.index,
    derivationPath: account.derivationPath,
    address: account.address,
    privateKeyMasked: `${account.privateKey.slice(0, 10)}...${account.privateKey.slice(-6)}`,
    publicKeyMasked: `${account.publicKey.slice(0, 10)}...${account.publicKey.slice(-6)}`,
  });
}

console.log("");

const account0First = deriveEvmAccount(mnemonic, 0);
const account0Second = deriveEvmAccount(mnemonic, 0);
const account1 = deriveEvmAccount(mnemonic, 1);

console.log("CHECKS:");

console.log(
  "Same mnemonic + same index gives same address:",
  account0First.address === account0Second.address
);

console.log(
  "Same mnemonic + different index gives different address:",
  account0First.address !== account1.address
);

console.log("Account 0 path:", account0First.derivationPath);
console.log("Account 1 path:", account1.derivationPath);