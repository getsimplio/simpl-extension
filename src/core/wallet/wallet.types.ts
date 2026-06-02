// src/core/wallet/wallet.types.ts

import type {
  WalletAccount,
  WalletAccountId,
  WalletAccountsState,
} from "../accounts/account.types";
import type { EvmPrivateKey } from "../accounts/derivation";
import type { NativeBalance } from "../balances/balance.service";
import type { MnemonicWordCount } from "../mnemonic/mnemonic.service";
import type { WalletState } from "../storage/storage.types";
import type { WalletAssetBalance } from "../tokens/token-balance.service";
import type { EncryptedVault, VaultPayload } from "../vault/vault.types";

export type WalletRuntimeStatus = "not_initialized" | "locked" | "unlocked";

export type WalletRuntimeState =
  | {
      status: "not_initialized";
      unlockedAt: null;
    }
  | {
      status: "locked";
      unlockedAt: null;
    }
  | {
      status: "unlocked";
      unlockedAt: string;
    };

export type CreateNewWalletInput = {
  password: string;
  wordCount?: MnemonicWordCount;
};

export type CreateNewWalletResult = {
  mnemonic: string;
  encryptedVault: EncryptedVault;
  walletState: WalletState;
  selectedAccount: WalletAccount;
};

export type ImportWalletInput = {
  mnemonic: string;
  password: string;
};

export type ImportWalletResult = {
  encryptedVault: EncryptedVault;
  walletState: WalletState;
  selectedAccount: WalletAccount;
};

export type UnlockWalletInput = {
  password: string;
};

export type UnlockWalletResult = {
  walletState: WalletState;
  selectedAccount: WalletAccount | null;
  runtimeState: WalletRuntimeState;
};

export type AddAccountInput = {
  password?: string;
  label?: string;
};

export type AddAccountResult = {
  walletState: WalletState;
  addedAccount: WalletAccount;
  selectedAccount: WalletAccount;
};

export type SelectAccountInput = {
  accountId: WalletAccountId;
};

export type SelectAccountResult = {
  walletState: WalletState;
  selectedAccount: WalletAccount;
};

export type RevealSeedPhraseInput = {
  password: string;
};

export type RevealSeedPhraseResult = {
  mnemonic: string;
};

export type RevealPrivateKeyInput = {
  password: string;
  accountId?: WalletAccountId;
};

export type RevealPrivateKeyResult = {
  account: WalletAccount;
  privateKey: EvmPrivateKey;
};

// A single exportable private key for an account. "shared" means one secp256k1
// key backs both the EVM and TRON addresses (private-key imports). Values are
// returned only after password verification and must never be persisted.
export type ExportedKeyFamily = "evm" | "tron" | "shared";

export type ExportedPrivateKey = {
  family: ExportedKeyFamily;
  label: string;
  privateKey: string;
  note?: string;
};

export type ExportAccountKeysInput = {
  accountId?: WalletAccountId;
  password: string;
};

export type ExportAccountKeysResult = {
  account: WalletAccount;
  keys: ExportedPrivateKey[];
};

// A public address row for an account, shown on the Accounts screen
// independently of the selected network. Never carries private key material.
export type AccountAddressFamily = "evm" | "tron";

export type AccountDisplayAddress = {
  family: AccountAddressFamily;
  label: string;
  address: string;
  explorerUrl?: string;
};

export type GetSelectedBalanceResult = NativeBalance;

export type GetSelectedPortfolioResult = {
  assets: WalletAssetBalance[];
  updatedAt: string;
};

export type SendSelectedAssetInput = {
  asset: WalletAssetBalance;
  toAddress: string;
  amount: string;
  password?: string;
};

export type SendSelectedAssetResult = {
  hash: string;
  chainId: number;
  assetSymbol: string;
  amount: string;
  toAddress: string;
  explorerUrl: string | null;
};

export type WalletOverview = {
  runtimeState: WalletRuntimeState;
  walletState: WalletState;
  selectedAccount: WalletAccount | null;
};

export type InternalUnlockedVault = {
  payload: VaultPayload;
  unlockedAt: string;
};

export type WalletBootstrapResult = {
  runtimeState: WalletRuntimeState;
  walletState: WalletState;
  encryptedVault: EncryptedVault | null;
  selectedAccount: WalletAccount | null;
};

export type WalletCreateInitialStateResult = {
  accountsState: WalletAccountsState;
  walletState: WalletState;
};