// src/core/accounts/account.service.ts

import { deriveEvmAccount, type EvmAddress } from "./derivation";
import type {
  CreateWalletAccountInput,
  CreateWatchWalletAccountInput,
  RenameWalletAccountInput,
  WalletAccount,
  WalletAccountId,
  WalletAccountsState,
} from "./account.types";

export class AccountService {
  createWalletAccount(input: CreateWalletAccountInput): WalletAccount {
    const { mnemonic, index, label } = input;

    const derivedAccount = deriveEvmAccount(mnemonic, index);

    return {
      id: this.createAccountId(derivedAccount.index),
      type: "mnemonic",
      index: derivedAccount.index,
      address: derivedAccount.address,
      label: label ?? this.createDefaultAccountLabel(derivedAccount.index),
      derivationPath: derivedAccount.derivationPath,
      createdAt: new Date().toISOString(),
    };
  }

  createWatchWalletAccount(input: CreateWatchWalletAccountInput): WalletAccount {
    const address = this.normalizeEvmAddress(input.address);
    const label = input.label?.trim() || "Watch wallet";

    return {
      id: this.createAccountId("watch"),
      type: "watch",
      index: null,
      address,
      label,
      derivationPath: null,
      createdAt: new Date().toISOString(),
    };
  }

  createFirstAccount(mnemonic: string): WalletAccount {
    return this.createWalletAccount({
      mnemonic,
      index: 0,
      label: "Account 1",
    });
  }

  createNextAccount(
    mnemonic: string,
    existingAccounts: WalletAccount[]
  ): WalletAccount {
    const nextIndex = this.getNextAccountIndex(existingAccounts);

    return this.createWalletAccount({
      mnemonic,
      index: nextIndex,
    });
  }

  createInitialAccountsState(mnemonic: string): WalletAccountsState {
    const firstAccount = this.createFirstAccount(mnemonic);

    return {
      selectedAccountId: firstAccount.id,
      accounts: [firstAccount],
    };
  }

  addAccountToState(
    state: WalletAccountsState,
    mnemonic: string
  ): WalletAccountsState {
    const newAccount = this.createNextAccount(mnemonic, state.accounts);

    return {
      selectedAccountId: newAccount.id,
      accounts: [...state.accounts, newAccount],
    };
  }

  addWatchAccountToState(
    state: WalletAccountsState,
    input: CreateWatchWalletAccountInput
  ): WalletAccountsState {
    const address = this.normalizeEvmAddress(input.address);

    const alreadyExists = state.accounts.some((account) => {
      return account.address.toLowerCase() === address.toLowerCase();
    });

    if (alreadyExists) {
      throw new Error("This wallet address is already added.");
    }

    const watchAccount = this.createWatchWalletAccount({
      ...input,
      address,
    });

    return {
      selectedAccountId: watchAccount.id,
      accounts: [...state.accounts, watchAccount],
    };
  }

  selectAccount(
    state: WalletAccountsState,
    accountId: WalletAccountId
  ): WalletAccountsState {
    const accountExists = state.accounts.some((account) => {
      return account.id === accountId;
    });

    if (!accountExists) {
      throw new Error("Account not found.");
    }

    return {
      ...state,
      selectedAccountId: accountId,
    };
  }

  getSelectedAccount(state: WalletAccountsState): WalletAccount | null {
    if (!state.selectedAccountId) {
      return null;
    }

    return (
      state.accounts.find((account) => {
        return account.id === state.selectedAccountId;
      }) ?? null
    );
  }

  renameAccount(
    state: WalletAccountsState,
    input: RenameWalletAccountInput
  ): WalletAccountsState {
    const label = input.label.trim();

    if (!label) {
      throw new Error("Account label cannot be empty.");
    }

    return {
      ...state,
      accounts: state.accounts.map((account) => {
        if (account.id !== input.accountId) {
          return account;
        }

        return {
          ...account,
          label,
        };
      }),
    };
  }

  getNextAccountIndex(accounts: WalletAccount[]): number {
    const mnemonicAccounts = accounts.filter((account) => {
      return account.type === "mnemonic";
    });

    if (mnemonicAccounts.length === 0) {
      return 0;
    }

    const maxIndex = Math.max(
      ...mnemonicAccounts.map((account) => {
        return account.index;
      })
    );

    return maxIndex + 1;
  }

  private normalizeEvmAddress(address: string): EvmAddress {
    const normalizedAddress = address.trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedAddress)) {
      throw new Error("Invalid EVM address.");
    }

    return normalizedAddress as EvmAddress;
  }

  private createDefaultAccountLabel(index: number): string {
    return `Account ${index + 1}`;
  }

  private createAccountId(scope: number | string): WalletAccountId {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return `account-${scope}-${Date.now()}`;
  }
}

export const accountService = new AccountService();