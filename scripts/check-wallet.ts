// scripts/check-wallet.ts

import { WalletService } from "../src/core/wallet/wallet.service";
import {
  MemoryStorageAdapter,
  StorageRepository,
} from "../src/core/storage/storage.repository";
import { SEPOLIA_CHAIN_ID } from "../src/core/networks/chain-registry";

const password = "strong-test-password-123";
const wrongPassword = "wrong-password-123";

const storage = new StorageRepository(new MemoryStorageAdapter());
const wallet = new WalletService(storage);

function maskPrivateKey(privateKey: string): string {
  return `${privateKey.slice(0, 10)}...${privateKey.slice(-6)}`;
}

console.log("START WALLET SERVICE CHECK");
console.log("");

console.log("CHECK 1 — bootstrap before wallet creation:");
const bootstrapBeforeCreate = await wallet.bootstrap();
console.log({
  status: bootstrapBeforeCreate.runtimeState.status,
  encryptedVaultExists: bootstrapBeforeCreate.encryptedVault !== null,
  accountsCount: bootstrapBeforeCreate.walletState.accounts.length,
});
console.log("");

console.log("CHECK 2 — create new wallet:");
const createdWallet = await wallet.createNewWallet({
  password,
  wordCount: 12,
});

console.log({
  mnemonic: createdWallet.mnemonic,
  selectedAccount: createdWallet.selectedAccount,
  accountsCount: createdWallet.walletState.accounts.length,
});
console.log("");

console.log("CHECK 3 — stored data does not contain secrets:");
const storedDataAfterCreate = await storage.getStoredWalletData();
const storedDataAsString = JSON.stringify(storedDataAfterCreate);

console.log({
  hasEncryptedVault: storedDataAfterCreate.encryptedVault !== null,
  hasAccounts: storedDataAfterCreate.walletState.accounts.length > 0,
  doesNotContainMnemonic: !storedDataAsString.includes(createdWallet.mnemonic),
  doesNotContainPassword: !storedDataAsString.includes(password),
  doesNotContainPrivateKeyField: !storedDataAsString.includes("privateKey"),
  doesNotContainPublicKeyField: !storedDataAsString.includes("publicKey"),
});
console.log("");

console.log("CHECK 4 — bootstrap after wallet creation:");
const bootstrapAfterCreate = await wallet.bootstrap();
console.log({
  status: bootstrapAfterCreate.runtimeState.status,
  selectedAccount: bootstrapAfterCreate.selectedAccount,
});
console.log("");

console.log("CHECK 5 — get selected account:");
const selectedAccount = await wallet.getSelectedAccount();
console.log(selectedAccount);
console.log("");

console.log("CHECK 6 — add second account while wallet is unlocked:");
const addedSecondAccount = await wallet.addAccount({
  label: "Trading Wallet",
});

console.log({
  addedAccount: addedSecondAccount.addedAccount,
  selectedAccount: addedSecondAccount.selectedAccount,
  accountsCount: addedSecondAccount.walletState.accounts.length,
});
console.log("");

console.log("CHECK 7 — add third account:");
const addedThirdAccount = await wallet.addAccount();

console.log({
  addedAccount: addedThirdAccount.addedAccount,
  selectedAccount: addedThirdAccount.selectedAccount,
  accountsCount: addedThirdAccount.walletState.accounts.length,
});
console.log("");

console.log("CHECK 8 — select first account:");
const firstAccountId = addedThirdAccount.walletState.accounts[0].id;

const selectedFirstAccount = await wallet.selectAccount({
  accountId: firstAccountId,
});

console.log({
  selectedAccount: selectedFirstAccount.selectedAccount,
});
console.log("");

console.log("CHECK 9 — reveal seed phrase with correct password:");
const revealedSeed = await wallet.revealSeedPhrase({
  password,
});

console.log({
  mnemonicMatches: revealedSeed.mnemonic === createdWallet.mnemonic,
});
console.log("");

console.log("CHECK 10 — reveal seed phrase with wrong password should fail:");

try {
  await wallet.revealSeedPhrase({
    password: wrongPassword,
  });

  console.log("Unexpected success");
} catch {
  console.log("Failed as expected");
}
console.log("");

console.log("CHECK 11 — reveal private key for selected account:");
const revealedPrivateKey = await wallet.revealPrivateKey({
  password,
});

console.log({
  accountLabel: revealedPrivateKey.account.label,
  accountAddress: revealedPrivateKey.account.address,
  privateKeyMasked: maskPrivateKey(revealedPrivateKey.privateKey),
});
console.log("");

console.log("CHECK 12 — lock wallet:");
const lockedState = wallet.lockWallet();

console.log(lockedState);
console.log("");

console.log("CHECK 13 — bootstrap after lock:");
const bootstrapAfterLock = await wallet.bootstrap();

console.log({
  status: bootstrapAfterLock.runtimeState.status,
  selectedAccount: bootstrapAfterLock.selectedAccount,
});
console.log("");

console.log("CHECK 14 — add account while locked without password should fail:");

try {
  await wallet.addAccount();

  console.log("Unexpected success");
} catch {
  console.log("Failed as expected");
}
console.log("");

console.log("CHECK 15 — unlock wallet:");
const unlockedWallet = await wallet.unlockWallet({
  password,
});

console.log({
  status: unlockedWallet.runtimeState.status,
  selectedAccount: unlockedWallet.selectedAccount,
  accountsCount: unlockedWallet.walletState.accounts.length,
});
console.log("");

console.log("CHECK 16 — switch selected chain to Sepolia:");
const updatedChainState = await wallet.setSelectedChainId(SEPOLIA_CHAIN_ID);

console.log({
  selectedChainId: updatedChainState.selectedChainId,
  isSepolia: updatedChainState.selectedChainId === SEPOLIA_CHAIN_ID,
});
console.log("");

console.log("CHECK 17 — get selected balance:");

try {
  const balance = await wallet.getSelectedBalance();

  console.log({
    address: balance.address,
    chainName: balance.chainName,
    symbol: balance.symbol,
    balanceWei: balance.balanceWei,
    formatted: `${balance.formatted} ${balance.symbol}`,
    updatedAt: balance.updatedAt,
  });
} catch (error) {
  console.log({
    failed: true,
    message: error instanceof Error ? error.message : String(error),
  });
}

console.log("");

console.log("CHECK 18 — clear wallet:");
await wallet.clearWallet();

const bootstrapAfterClear = await wallet.bootstrap();

console.log({
  status: bootstrapAfterClear.runtimeState.status,
  encryptedVaultExists: bootstrapAfterClear.encryptedVault !== null,
  accountsCount: bootstrapAfterClear.walletState.accounts.length,
  selectedAccount: bootstrapAfterClear.selectedAccount,
});
console.log("");

console.log("WALLET SERVICE CHECK FINISHED");