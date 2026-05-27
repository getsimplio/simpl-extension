import type { EvmAddress, EvmDerivationPath } from "./derivation";

export type WalletAccountId = string;

export type WalletAccountType = "mnemonic" | "watch";

export type MnemonicWalletAccount = {
  id: WalletAccountId;
  type: "mnemonic";
  index: number;
  address: EvmAddress;
  label: string;
  derivationPath: EvmDerivationPath;
  createdAt: string;
};

export type WatchWalletAccount = {
  id: WalletAccountId;
  type: "watch";
  index: null;
  address: EvmAddress;
  label: string;
  derivationPath: null;
  createdAt: string;
};

export type WalletAccount = MnemonicWalletAccount | WatchWalletAccount;

export type WalletAccountsState = {
  selectedAccountId: WalletAccountId | null;
  accounts: WalletAccount[];
};

export type CreateWalletAccountInput = {
  mnemonic: string;
  index: number;
  label?: string;
};

export type CreateWatchWalletAccountInput = {
  address: EvmAddress;
  label?: string;
};

export type RenameWalletAccountInput = {
  accountId: WalletAccountId;
  label: string;
};