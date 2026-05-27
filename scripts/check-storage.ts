// scripts/check-storage.ts

import { mnemonicService } from "../src/core/mnemonic/mnemonic.service";
import { accountService } from "../src/core/accounts/account.service";
import { vaultService } from "../src/core/vault/vault.service";
import {
  MemoryStorageAdapter,
  StorageRepository,
} from "../src/core/storage/storage.repository";
import { DEFAULT_WALLET_SETTINGS } from "../src/core/storage/storage.types";

const password = "strong-test-password-123";

console.log("START STORAGE CHECK");
console.log("");

const mnemonic = mnemonicService.generateMnemonic({ wordCount: 12 });

console.log("DEMO MNEMONIC:");
console.log(mnemonic);
console.log("");

const encryptedVault = await vaultService.createVault({
  mnemonic,
  password,
});

const accountsState = accountService.createInitialAccountsState(mnemonic);

let walletState = {
  selectedAccountId: accountsState.selectedAccountId,
  selectedChainId: 1,
  accounts: accountsState.accounts,
  settings: {
    ...DEFAULT_WALLET_SETTINGS,
  },
};

const storage = new StorageRepository(new MemoryStorageAdapter());

await storage.saveStoredWalletData({
  encryptedVault,
  walletState,
});

const storedData = await storage.getStoredWalletData();

console.log("STORED DATA:");
console.log(JSON.stringify(storedData, null, 2));
console.log("");

const storedDataAsString = JSON.stringify(storedData);

console.log("CHECK 1 — storage has encrypted vault:");
console.log(storedData.encryptedVault !== null);
console.log("");

console.log("CHECK 2 — storage has wallet state:");
console.log(storedData.walletState !== null);
console.log("");

console.log("CHECK 3 — storage has accounts:");
console.log(storedData.walletState.accounts.length > 0);
console.log("");

console.log("CHECK 4 — selected account id exists:");
console.log(Boolean(storedData.walletState.selectedAccountId));
console.log("");

console.log("CHECK 5 — selected account exists in accounts list:");
const selectedAccount = storedData.walletState.accounts.find((account) => {
  return account.id === storedData.walletState.selectedAccountId;
});
console.log(Boolean(selectedAccount));
console.log("");

console.log("CHECK 6 — selected chain id is saved:");
console.log(storedData.walletState.selectedChainId === 1);
console.log("");

console.log("CHECK 7 — settings are saved:");
console.log(
  storedData.walletState.settings.autoLockMinutes === 15 &&
    storedData.walletState.settings.hideBalances === false &&
    storedData.walletState.settings.fiatCurrency === "USD" &&
    storedData.walletState.settings.biometricUnlock.enabled === false &&
    storedData.walletState.settings.biometricUnlock.credentialId === null &&
    storedData.walletState.settings.biometricUnlock.createdAt === null
);
console.log("");
console.log("");

console.log("CHECK 8 — storage does not contain mnemonic:");
console.log(!storedDataAsString.includes(mnemonic));
console.log("");

console.log("CHECK 9 — storage does not contain password:");
console.log(!storedDataAsString.includes(password));
console.log("");

console.log("CHECK 10 — storage does not contain privateKey field:");
console.log(!storedDataAsString.includes("privateKey"));
console.log("");

console.log("CHECK 11 — storage does not contain publicKey field:");
console.log(!storedDataAsString.includes("publicKey"));
console.log("");

console.log("CHECK 12 — encrypted vault can be unlocked:");
if (!storedData.encryptedVault) {
  throw new Error("Encrypted vault not found.");
}

const unlockedPayload = await vaultService.unlockVault({
  encryptedVault: storedData.encryptedVault,
  password,
});

console.log({
  mnemonicMatches: unlockedPayload.mnemonic === mnemonic,
});
console.log("");

console.log("CHECK 13 — update selected chain id:");
const updatedChainState = await storage.setSelectedChainId(11155111);
console.log({
  selectedChainId: updatedChainState.selectedChainId,
  isSepolia: updatedChainState.selectedChainId === 11155111,
});
console.log("");

console.log("CHECK 14 — update settings:");
const updatedSettingsState = await storage.updateSettings({
  hideBalances: true,
  fiatCurrency: "EUR",
});

console.log({
  hideBalances: updatedSettingsState.settings.hideBalances,
  fiatCurrency: updatedSettingsState.settings.fiatCurrency,
  settingsUpdated:
    updatedSettingsState.settings.hideBalances === true &&
    updatedSettingsState.settings.fiatCurrency === "EUR",
});
console.log("");

console.log("CHECK 15 — remove encrypted vault:");
await storage.removeEncryptedVault();

const encryptedVaultAfterRemove = await storage.getEncryptedVault();

console.log({
  encryptedVaultRemoved: encryptedVaultAfterRemove === null,
});
console.log("");

console.log("CHECK 16 — clear wallet data:");
await storage.saveStoredWalletData({
  encryptedVault,
  walletState,
});

await storage.clearWalletData();

const dataAfterClear = await storage.getStoredWalletData();

console.log({
  encryptedVaultIsNull: dataAfterClear.encryptedVault === null,
  accountsAreEmpty: dataAfterClear.walletState.accounts.length === 0,
  selectedAccountIsNull: dataAfterClear.walletState.selectedAccountId === null,
});
console.log("");

console.log("STORAGE CHECK FINISHED");