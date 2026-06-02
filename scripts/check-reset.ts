// scripts/check-reset.ts
//
// Regression check for the wallet reset/clear flow: clearing the wallet must
// remove ALL wallet-scoped local data (vault, accounts, custom/imported tokens,
// hidden-asset overrides, transaction history, portfolio cache, watched assets,
// non-prefixed wallet keys) while preserving app-level preferences and the
// built-in registry tokens that live in source code.

// --- Minimal in-memory localStorage so the localStorage sweep runs in Node ---
class MemoryLocalStorage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const memoryLocalStorage = new MemoryLocalStorage();
(
  globalThis as typeof globalThis & {
    window?: { localStorage: MemoryLocalStorage };
  }
).window = { localStorage: memoryLocalStorage };

// Imports AFTER the window shim — these singletons only touch window at call
// time, so the shim is in place before any storage access.
const { mnemonicService } = await import("../src/core/mnemonic/mnemonic.service");
const { accountService } = await import("../src/core/accounts/account.service");
const { vaultService } = await import("../src/core/vault/vault.service");
const { customTokenService } = await import(
  "../src/core/tokens/custom-token.service"
);
const { hiddenAssetService } = await import(
  "../src/core/tokens/hidden-asset.service"
);
const { transactionHistoryService } = await import(
  "../src/core/transactions/transaction-history.service"
);
const { getRegisteredTokensByChainId } = await import(
  "../src/core/tokens/token-registry"
);
const { MemoryStorageAdapter, StorageRepository } = await import(
  "../src/core/storage/storage.repository"
);
const { DEFAULT_WALLET_SETTINGS } = await import(
  "../src/core/storage/storage.types"
);

const BNB_CHAIN_ID = 56;
const password = "strong-test-password-123";

console.log("START RESET CHECK");
console.log("");

// ── Seed a wallet + every kind of wallet-scoped local data ──
const mnemonic = mnemonicService.generateMnemonic({ wordCount: 12 });
const encryptedVault = await vaultService.createVault({ mnemonic, password });
const accountsState = accountService.createInitialAccountsState(mnemonic);
const ownerAddress = accountsState.accounts[0].address;

const adapter = new MemoryStorageAdapter();
const storage = new StorageRepository(adapter);

await storage.saveStoredWalletData({
  encryptedVault,
  walletState: {
    selectedAccountId: accountsState.selectedAccountId,
    selectedChainId: BNB_CHAIN_ID,
    accounts: accountsState.accounts,
    settings: { ...DEFAULT_WALLET_SETTINGS },
  },
});

// Watched asset (chrome.storage.local)
await adapter.set({ watchedAssets: [{ chainId: BNB_CHAIN_ID, symbol: "X" }] });

// Imported custom token (simple:customTokens:56) — mimics CAKE on BNB Chain.
customTokenService.addToken({
  chainId: BNB_CHAIN_ID,
  address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  symbol: "CAKE",
  name: "PancakeSwap Token",
  decimals: 18,
  createdAt: new Date().toISOString(),
});

// Hidden-asset override (simple:hiddenAssets)
hiddenAssetService.hideAsset(BNB_CHAIN_ID, "0x1234567890abcdef1234567890abcdef12345678");

// Transaction history (simple:transactionHistory:v1)
transactionHistoryService.addTransaction({
  hash: "0xabc",
  chainId: BNB_CHAIN_ID,
  chainName: "BNB Chain",
  direction: "send",
  status: "submitted",
  assetType: "native",
  assetSymbol: "BNB",
  assetName: "BNB",
  contractAddress: null,
  amount: "1",
  fromAddress: ownerAddress,
  toAddress: ownerAddress,
  explorerUrl: null,
  createdAt: new Date().toISOString(),
});

// Portfolio cache (simple:portfolio:*) and a non-prefixed wallet key.
memoryLocalStorage.setItem(
  `simple:portfolio:${BNB_CHAIN_ID}:${ownerAddress.toLowerCase()}`,
  JSON.stringify({ assets: [{ symbol: "CAKE" }], updatedAt: Date.now() }),
);
memoryLocalStorage.setItem("settings", JSON.stringify({ hideBalances: true }));

// App-level preference that MUST survive the reset (dot namespace, not colon).
memoryLocalStorage.setItem("simple.actionMode", "sidepanel");

// ── Sanity: everything is present before the reset ──
const seededOk =
  customTokenService.getTokensByChainId(BNB_CHAIN_ID).length === 1 &&
  hiddenAssetService.getHiddenAddresses(BNB_CHAIN_ID).length === 1 &&
  transactionHistoryService.list().length === 1;
console.log("SEED — wallet-scoped data present:", seededOk);
console.log("");

// ── Reset ──
await storage.clearWalletScopedStorage();

// ── Assertions ──
const walletDataAfter = await storage.getStoredWalletData();
const watchedAfter = await adapter.get(["watchedAssets"]);
const builtInTokens = getRegisteredTokensByChainId(BNB_CHAIN_ID);

const checks: Array<{ name: string; pass: boolean }> = [
  {
    name: "vault removed",
    pass: walletDataAfter.encryptedVault === null,
  },
  {
    name: "accounts cleared",
    pass: walletDataAfter.walletState.accounts.length === 0,
  },
  {
    name: "selected account cleared",
    pass: walletDataAfter.walletState.selectedAccountId === null,
  },
  {
    name: "watched assets cleared",
    pass: watchedAfter.watchedAssets === undefined,
  },
  {
    name: "imported custom token gone",
    pass: customTokenService.getTokensByChainId(BNB_CHAIN_ID).length === 0,
  },
  {
    name: "hidden-asset overrides gone",
    pass: hiddenAssetService.getHiddenAddresses(BNB_CHAIN_ID).length === 0,
  },
  {
    name: "transaction history empty",
    pass: transactionHistoryService.list().length === 0,
  },
  {
    name: "portfolio cache cleared",
    pass:
      memoryLocalStorage.getItem(
        `simple:portfolio:${BNB_CHAIN_ID}:${ownerAddress.toLowerCase()}`,
      ) === null,
  },
  {
    name: "non-prefixed wallet key (settings) cleared",
    pass: memoryLocalStorage.getItem("settings") === null,
  },
  {
    name: "app-level pref (simple.actionMode) preserved",
    pass: memoryLocalStorage.getItem("simple.actionMode") === "sidepanel",
  },
  {
    name: "built-in registry tokens remain",
    pass: builtInTokens.length > 0,
  },
];

console.log("RESET CHECKS:");
let allPass = true;
for (const check of checks) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"} — ${check.name}`);
  if (!check.pass) allPass = false;
}
console.log("");
console.log(allPass ? "RESET CHECK PASSED" : "RESET CHECK FAILED");

if (!allPass) {
  process.exit(1);
}
