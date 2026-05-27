// src/core/storage/storage.types.ts

import type {
  WalletAccount,
  WalletAccountId,
} from "../accounts/account.types";
import type { EncryptedVault } from "../vault/vault.types";

export type FiatCurrency = "USD" | "EUR";

export type BiometricUnlockSettings = {
  enabled: boolean;
  credentialId: string | null;
  createdAt: string | null;
};

export type WalletSettings = {
  autoLockMinutes: number;
  hideBalances: boolean;
  fiatCurrency: FiatCurrency;
  biometricUnlock: BiometricUnlockSettings;
  balanceAutoRefreshSeconds: number;
};

export type WalletState = {
  selectedAccountId: WalletAccountId | null;
  selectedChainId: number;
  accounts: WalletAccount[];
  settings: WalletSettings;
};

export type StoredWalletData = {
  encryptedVault: EncryptedVault | null;
  walletState: WalletState;
};

export const STORAGE_KEYS = {
  encryptedVault: "encryptedVault",
  walletState: "walletState",
} as const;

export const DEFAULT_SELECTED_CHAIN_ID = 1;

export const DEFAULT_BALANCE_AUTO_REFRESH_SECONDS = 30;

export const DEFAULT_BIOMETRIC_UNLOCK_SETTINGS: BiometricUnlockSettings = {
  enabled: false,
  credentialId: null,
  createdAt: null,
};

export const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  autoLockMinutes: 15,
  hideBalances: false,
  fiatCurrency: "USD",
  biometricUnlock: {
    ...DEFAULT_BIOMETRIC_UNLOCK_SETTINGS,
  },
  balanceAutoRefreshSeconds: DEFAULT_BALANCE_AUTO_REFRESH_SECONDS,
};

export function createDefaultWalletState(): WalletState {
  return {
    selectedAccountId: null,
    selectedChainId: DEFAULT_SELECTED_CHAIN_ID,
    accounts: [],
    settings: {
      ...DEFAULT_WALLET_SETTINGS,
      biometricUnlock: {
        ...DEFAULT_WALLET_SETTINGS.biometricUnlock,
      },
    },
  };
}