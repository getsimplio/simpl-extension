// scripts/check-vault.ts

import { mnemonicService } from "../src/core/mnemonic/mnemonic.service";
import { vaultService } from "../src/core/vault/vault.service";

const password = "strong-test-password-123";
const wrongPassword = "wrong-password-123";

const mnemonic = mnemonicService.generateMnemonic({ wordCount: 12 });

console.log("DEMO MNEMONIC:");
console.log(mnemonic);
console.log("");

const encryptedVault = await vaultService.createVault({
  mnemonic,
  password,
});

console.log("ENCRYPTED VAULT:");
console.log(JSON.stringify(encryptedVault, null, 2));
console.log("");

const encryptedVaultAsString = JSON.stringify(encryptedVault);

console.log("CHECK 1 — encrypted vault does not contain mnemonic:");
console.log(!encryptedVaultAsString.includes(mnemonic));
console.log("");

console.log("CHECK 2 — unlock with correct password:");
const unlockedPayload = await vaultService.unlockVault({
  encryptedVault,
  password,
});

console.log({
  mnemonicMatches: unlockedPayload.mnemonic === mnemonic,
  createdAt: unlockedPayload.createdAt,
});
console.log("");

console.log("CHECK 3 — reveal mnemonic:");
const revealedMnemonic = await vaultService.revealMnemonic({
  encryptedVault,
  password,
});

console.log({
  revealedMnemonicMatches: revealedMnemonic === mnemonic,
});
console.log("");

console.log("CHECK 4 — verify correct password:");
const isCorrectPassword = await vaultService.verifyPassword({
  encryptedVault,
  password,
});

console.log(isCorrectPassword);
console.log("");

console.log("CHECK 5 — verify wrong password:");
const isWrongPassword = await vaultService.verifyPassword({
  encryptedVault,
  password: wrongPassword,
});

console.log(isWrongPassword);
console.log("");

console.log("CHECK 6 — unlock with wrong password should fail:");

try {
  await vaultService.unlockVault({
    encryptedVault,
    password: wrongPassword,
  });

  console.log("Unexpected success");
} catch (error) {
  console.log("Failed as expected");
}
console.log("");

console.log("CHECK 7 — change password:");

const newPassword = "new-strong-test-password-456";

const reEncryptedVault = await vaultService.changePassword({
  encryptedVault,
  oldPassword: password,
  newPassword,
});

const unlockedWithNewPassword = await vaultService.unlockVault({
  encryptedVault: reEncryptedVault,
  password: newPassword,
});

console.log({
  mnemonicMatchesAfterPasswordChange:
    unlockedWithNewPassword.mnemonic === mnemonic,
});