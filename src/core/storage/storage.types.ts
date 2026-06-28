// src/core/storage/storage.types.ts

import type {
  WalletAccount,
  WalletAccountId,
} from "../accounts/account.types";
import type { EncryptedVault } from "../vault/vault.types";

export type FiatCurrency = "USD" | "EUR";

// Appearance preference. "system" follows the OS color scheme; "light"/"dark"
// pin a theme regardless of the OS. Applied as `data-theme` on the document root.
export type ThemePreference = "system" | "light" | "dark";

// Interface languages simpl ships translations for. Keep this list in sync with
// the locale dictionaries in `src/i18n/locales`.
export type SupportedLocale =
  | "en"
  | "ru"
  | "es-419"
  | "pt-BR"
  | "tr"
  | "uk"
  | "vi"
  | "id";

// Language preference. "auto" follows the browser language (falling back to
// English when it is not supported); any other value pins that language. Mirrors
// the "system"/explicit shape of ThemePreference.
export type LocalePreference = "auto" | SupportedLocale;

// Where simpl opens when the toolbar icon is clicked. "popup" is the classic
// extension popup; "sidePanel" opens the slide-out browser side panel instead;
// "fullscreen" hands off to a centered full-page tab. "popup" is always the
// safe default and the user can return to it from Settings at any time.
export type DefaultOpenMode = "popup" | "sidePanel" | "fullscreen";

export type BiometricUnlockSettings = {
  enabled: boolean;
  credentialId: string | null;
  createdAt: string | null;
  // WebAuthn-PRF wrapping material. The wallet password is AES-GCM-encrypted
  // with a key derived from the platform authenticator; only the ciphertext and
  // public parameters live here — never a raw secret. All base64.
  prfSalt: string | null;
  iv: string | null;
  wrappedSecret: string | null;
};

export type WalletSettings = {
  autoLockMinutes: number;
  hideBalances: boolean;
  fiatCurrency: FiatCurrency;
  biometricUnlock: BiometricUnlockSettings;
  balanceAutoRefreshSeconds: number;
  defaultOpenMode: DefaultOpenMode;
  theme: ThemePreference;
  locale: LocalePreference;
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
  prfSalt: null,
  iv: null,
  wrappedSecret: null,
};

export const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  autoLockMinutes: 15,
  hideBalances: false,
  fiatCurrency: "USD",
  biometricUnlock: {
    ...DEFAULT_BIOMETRIC_UNLOCK_SETTINGS,
  },
  balanceAutoRefreshSeconds: DEFAULT_BALANCE_AUTO_REFRESH_SECONDS,
  defaultOpenMode: "popup",
  theme: "system",
  locale: "auto",
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