// src/core/storage/storage.repository.ts

import type { WalletAccount, WalletAccountId } from "../accounts/account.types";
import type { EncryptedVault } from "../vault/vault.types";
import {
  createDefaultWalletState,
  DEFAULT_SELECTED_CHAIN_ID,
  DEFAULT_WALLET_SETTINGS,
  STORAGE_KEYS,
  type StoredWalletData,
  type WalletSettings,
  type WalletState,
} from "./storage.types";

type StorageRecord = Record<string, unknown>;

export interface KeyValueStorageAdapter {
  get(keys: string[]): Promise<StorageRecord>;
  set(items: StorageRecord): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

type ChromeStorageAreaLike = {
  get(keys: string[]): Promise<StorageRecord>;
  set(items: StorageRecord): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
};

type ChromeLike = {
  storage?: {
    local?: ChromeStorageAreaLike;
  };
};

export class ChromeStorageAdapter implements KeyValueStorageAdapter {
  constructor(private readonly storageArea: ChromeStorageAreaLike) {}

  async get(keys: string[]): Promise<StorageRecord> {
    return this.storageArea.get(keys);
  }

  async set(items: StorageRecord): Promise<void> {
    await this.storageArea.set(items);
  }

  async remove(keys: string[]): Promise<void> {
    await this.storageArea.remove(keys);
  }

  async clear(): Promise<void> {
    await this.storageArea.clear();
  }
}

export class MemoryStorageAdapter implements KeyValueStorageAdapter {
  private readonly store = new Map<string, unknown>();

  async get(keys: string[]): Promise<StorageRecord> {
    const result: StorageRecord = {};

    for (const key of keys) {
      if (this.store.has(key)) {
        result[key] = this.clone(this.store.get(key));
      }
    }

    return result;
  }

  async set(items: StorageRecord): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.store.set(key, this.clone(value));
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  private clone<T>(value: T): T {
    if (typeof globalThis.structuredClone === "function") {
      return globalThis.structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export function createDefaultStorageAdapter(): KeyValueStorageAdapter {
  const chromeLike = (globalThis as typeof globalThis & { chrome?: ChromeLike })
    .chrome;

  if (chromeLike?.storage?.local) {
    return new ChromeStorageAdapter(chromeLike.storage.local);
  }

  return new MemoryStorageAdapter();
}

export class StorageRepository {
  constructor(
    private readonly storageAdapter: KeyValueStorageAdapter =
      createDefaultStorageAdapter()
  ) {}

  async getEncryptedVault(): Promise<EncryptedVault | null> {
    const result = await this.storageAdapter.get([STORAGE_KEYS.encryptedVault]);

    return (
      (result[STORAGE_KEYS.encryptedVault] as EncryptedVault | undefined) ??
      null
    );
  }

  async saveEncryptedVault(encryptedVault: EncryptedVault): Promise<void> {
    await this.storageAdapter.set({
      [STORAGE_KEYS.encryptedVault]: encryptedVault,
    });
  }

  async removeEncryptedVault(): Promise<void> {
    await this.storageAdapter.remove([STORAGE_KEYS.encryptedVault]);
  }

  async getWalletState(): Promise<WalletState> {
    const result = await this.storageAdapter.get([STORAGE_KEYS.walletState]);

    return this.normalizeWalletState(result[STORAGE_KEYS.walletState]);
  }

  async saveWalletState(walletState: WalletState): Promise<void> {
    await this.storageAdapter.set({
      [STORAGE_KEYS.walletState]: walletState,
    });
  }

  async getStoredWalletData(): Promise<StoredWalletData> {
    const result = await this.storageAdapter.get([
      STORAGE_KEYS.encryptedVault,
      STORAGE_KEYS.walletState,
    ]);

    return {
      encryptedVault:
        (result[STORAGE_KEYS.encryptedVault] as EncryptedVault | undefined) ??
        null,
      walletState: this.normalizeWalletState(result[STORAGE_KEYS.walletState]),
    };
  }

  async saveStoredWalletData(data: StoredWalletData): Promise<void> {
    await this.storageAdapter.set({
      [STORAGE_KEYS.encryptedVault]: data.encryptedVault,
      [STORAGE_KEYS.walletState]: data.walletState,
    });
  }

  async isWalletInitialized(): Promise<boolean> {
    const encryptedVault = await this.getEncryptedVault();

    return encryptedVault !== null;
  }

  async updateWalletState(
    updater: (currentState: WalletState) => WalletState
  ): Promise<WalletState> {
    const currentState = await this.getWalletState();
    const nextState = updater(currentState);

    await this.saveWalletState(nextState);

    return nextState;
  }

  async setSelectedAccountId(
    selectedAccountId: WalletAccountId | null
  ): Promise<WalletState> {
    return this.updateWalletState((currentState) => {
      return {
        ...currentState,
        selectedAccountId,
      };
    });
  }

  async setSelectedChainId(selectedChainId: number): Promise<WalletState> {
    if (!Number.isInteger(selectedChainId)) {
      throw new Error("Selected chain id must be an integer.");
    }

    if (selectedChainId <= 0) {
      throw new Error("Selected chain id must be greater than 0.");
    }

    return this.updateWalletState((currentState) => {
      return {
        ...currentState,
        selectedChainId,
      };
    });
  }

  async updateSettings(
    settingsPatch: Partial<WalletSettings>
  ): Promise<WalletState> {
    return this.updateWalletState((currentState) => {
      return {
        ...currentState,
        settings: {
          ...currentState.settings,
          ...settingsPatch,
        },
      };
    });
  }

  async clearWalletData(): Promise<void> {
    await this.storageAdapter.remove([
      STORAGE_KEYS.encryptedVault,
      STORAGE_KEYS.walletState,
    ]);
  }

  async clearAll(): Promise<void> {
    await this.storageAdapter.clear();
  }

  private normalizeWalletState(value: unknown): WalletState {
    if (!this.isObject(value)) {
      return createDefaultWalletState();
    }

    const maybeState = value as Partial<WalletState>;

    return {
      selectedAccountId:
        typeof maybeState.selectedAccountId === "string"
          ? maybeState.selectedAccountId
          : null,

      selectedChainId:
        typeof maybeState.selectedChainId === "number" &&
        Number.isInteger(maybeState.selectedChainId) &&
        maybeState.selectedChainId > 0
          ? maybeState.selectedChainId
          : DEFAULT_SELECTED_CHAIN_ID,

      accounts: this.normalizeAccounts(maybeState.accounts),

      settings: this.normalizeSettings(maybeState.settings),
    };
  }

  private normalizeAccounts(value: unknown): WalletAccount[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value as WalletAccount[];
  }

  private normalizeSettings(value: unknown): WalletSettings {
    if (!this.isObject(value)) {
      return {
        ...DEFAULT_WALLET_SETTINGS,
        biometricUnlock: {
          ...DEFAULT_WALLET_SETTINGS.biometricUnlock,
        },
      };
    }

    const biometricUnlock = this.isObject(value.biometricUnlock)
      ? value.biometricUnlock
      : {};

    return {
      autoLockMinutes:
        typeof value.autoLockMinutes === "number" &&
        Number.isInteger(value.autoLockMinutes) &&
        value.autoLockMinutes > 0
          ? value.autoLockMinutes
          : DEFAULT_WALLET_SETTINGS.autoLockMinutes,

      hideBalances:
        typeof value.hideBalances === "boolean"
          ? value.hideBalances
          : DEFAULT_WALLET_SETTINGS.hideBalances,

      fiatCurrency:
        value.fiatCurrency === "USD" || value.fiatCurrency === "EUR"
          ? value.fiatCurrency
          : DEFAULT_WALLET_SETTINGS.fiatCurrency,

      biometricUnlock: {
        enabled:
          typeof biometricUnlock.enabled === "boolean"
            ? biometricUnlock.enabled
            : DEFAULT_WALLET_SETTINGS.biometricUnlock.enabled,

        credentialId:
          typeof biometricUnlock.credentialId === "string"
            ? biometricUnlock.credentialId
            : DEFAULT_WALLET_SETTINGS.biometricUnlock.credentialId,

        createdAt:
          typeof biometricUnlock.createdAt === "string"
            ? biometricUnlock.createdAt
            : DEFAULT_WALLET_SETTINGS.biometricUnlock.createdAt,
      },

      balanceAutoRefreshSeconds:
        typeof value.balanceAutoRefreshSeconds === "number" &&
        Number.isFinite(value.balanceAutoRefreshSeconds)
          ? Math.min(60, Math.max(1, Math.trunc(value.balanceAutoRefreshSeconds)))
          : DEFAULT_WALLET_SETTINGS.balanceAutoRefreshSeconds,
    };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
}

export const storageRepository = new StorageRepository();