// src/core/wallet/wallet.service.ts

import { JsonRpcProvider } from "ethers";
import { accountService } from "../accounts/account.service";
import type {
  WalletAccount,
  WalletAccountId,
} from "../accounts/account.types";
import {
  deriveEvmPrivateKey,
  type EvmAddress,
} from "../accounts/derivation";
import { balanceService } from "../balances/balance.service";
import { mnemonicService } from "../mnemonic/mnemonic.service";
import { networkService } from "../networks/network.service";
import { assertValidPassword } from "../security/password-policy";
import {
  DEFAULT_SELECTED_CHAIN_ID,
  DEFAULT_WALLET_SETTINGS,
  type WalletState,
} from "../storage/storage.types";
import {
  storageRepository,
  type StorageRepository,
} from "../storage/storage.repository";
import {
  tokenBalanceService,
  type WalletPortfolio,
} from "../tokens/token-balance.service";
import {
  sendAssetService,
  type PreparedTransactionRequest,
  type SendPreparedTransactionResult,
} from "../transactions/send-asset.service";
import { vaultService } from "../vault/vault.service";
import type { EncryptedVault } from "../vault/vault.types";
import type {
  AddAccountInput,
  AddAccountResult,
  CreateNewWalletInput,
  CreateNewWalletResult,
  GetSelectedBalanceResult,
  ImportWalletInput,
  ImportWalletResult,
  InternalUnlockedVault,
  RevealPrivateKeyInput,
  RevealPrivateKeyResult,
  RevealSeedPhraseInput,
  RevealSeedPhraseResult,
  SelectAccountInput,
  SelectAccountResult,
  SendSelectedAssetInput,
  SendSelectedAssetResult,
  UnlockWalletInput,
  UnlockWalletResult,
  WalletBootstrapResult,
  WalletCreateInitialStateResult,
  WalletOverview,
  WalletRuntimeState,
} from "./wallet.types";

export class WalletService {
  private unlockedVault: InternalUnlockedVault | null = null;

  constructor(private readonly storage: StorageRepository = storageRepository) {}

  async bootstrap(): Promise<WalletBootstrapResult> {
    const storedData = await this.storage.getStoredWalletData();
    const selectedAccount = accountService.getSelectedAccount(
      this.toAccountsState(storedData.walletState),
    );

    return {
      encryptedVault: storedData.encryptedVault,
      walletState: storedData.walletState,
      selectedAccount,
      runtimeState: this.getRuntimeState(storedData.encryptedVault),
    };
  }

  async createNewWallet(
    input: CreateNewWalletInput,
  ): Promise<CreateNewWalletResult> {
    const alreadyInitialized = await this.storage.isWalletInitialized();

    if (alreadyInitialized) {
      throw new Error("Wallet is already initialized.");
    }

    const mnemonic = mnemonicService.generateMnemonic({
      wordCount: input.wordCount ?? 12,
    });

    const encryptedVault = await vaultService.createVault({
      mnemonic,
      password: input.password,
    });

    const { walletState } = this.createInitialWalletState(mnemonic);
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    await this.storage.saveStoredWalletData({
      encryptedVault,
      walletState,
    });

    const unlockedAt = new Date().toISOString();

    this.unlockedVault = {
      payload: {
        mnemonic,
        createdAt: unlockedAt,
      },
      unlockedAt,
    };

    return {
      mnemonic,
      encryptedVault,
      walletState,
      selectedAccount,
    };
  }

  async importWallet(input: ImportWalletInput): Promise<ImportWalletResult> {
    const alreadyInitialized = await this.storage.isWalletInitialized();

    if (alreadyInitialized) {
      throw new Error("Wallet is already initialized.");
    }

    assertValidPassword(input.password);

    const validationResult = mnemonicService.validateMnemonic(input.mnemonic);

    if (!validationResult.valid) {
      throw new Error(validationResult.message);
    }

    const mnemonic = validationResult.mnemonic;

    const encryptedVault = await vaultService.createVault({
      mnemonic,
      password: input.password,
    });

    const { walletState } = this.createInitialWalletState(mnemonic);
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    await this.storage.saveStoredWalletData({
      encryptedVault,
      walletState,
    });

    const unlockedAt = new Date().toISOString();

    this.unlockedVault = {
      payload: {
        mnemonic,
        createdAt: unlockedAt,
      },
      unlockedAt,
    };

    return {
      encryptedVault,
      walletState,
      selectedAccount,
    };
  }

  async unlockWallet(input: UnlockWalletInput): Promise<UnlockWalletResult> {
    const encryptedVault = await this.getRequiredEncryptedVault();

    const payload = await vaultService.unlockVault({
      encryptedVault,
      password: input.password,
    });

    const unlockedAt = new Date().toISOString();

    this.unlockedVault = {
      payload,
      unlockedAt,
    };

    const walletState = await this.storage.getWalletState();
    const selectedAccount = accountService.getSelectedAccount(
      this.toAccountsState(walletState),
    );

    return {
      walletState,
      selectedAccount,
      runtimeState: {
        status: "unlocked",
        unlockedAt,
      },
    };
  }

  lockWallet(): WalletRuntimeState {
    this.unlockedVault = null;

    return {
      status: "locked",
      unlockedAt: null,
    };
  }

  async getOverview(): Promise<WalletOverview> {
    const storedData = await this.storage.getStoredWalletData();
    const selectedAccount = accountService.getSelectedAccount(
      this.toAccountsState(storedData.walletState),
    );

    return {
      runtimeState: this.getRuntimeState(storedData.encryptedVault),
      walletState: storedData.walletState,
      selectedAccount,
    };
  }

  async getSelectedAccount(): Promise<WalletAccount | null> {
    const walletState = await this.storage.getWalletState();

    return accountService.getSelectedAccount(this.toAccountsState(walletState));
  }

  async addAccount(input: AddAccountInput = {}): Promise<AddAccountResult> {
    const mnemonic = await this.getMnemonicForSensitiveOperation(
      input.password,
    );

    const currentWalletState = await this.storage.getWalletState();

    const nextAccountsState = accountService.addAccountToState(
      this.toAccountsState(currentWalletState),
      mnemonic,
    );

    const addedAccount = this.getRequiredSelectedAccountFromAccountsState(
      nextAccountsState,
    );

    const nextWalletState: WalletState = {
      ...currentWalletState,
      selectedAccountId: nextAccountsState.selectedAccountId,
      accounts: input.label
        ? nextAccountsState.accounts.map((account) => {
            if (account.id !== addedAccount.id) {
              return account;
            }

            return {
              ...account,
              label: input.label?.trim() || account.label,
            };
          })
        : nextAccountsState.accounts,
    };

    await this.storage.saveWalletState(nextWalletState);

    const selectedAccount = this.getRequiredSelectedAccount(nextWalletState);

    return {
      walletState: nextWalletState,
      addedAccount: selectedAccount,
      selectedAccount,
    };
  }

  async addWatchAccount(input: {
    address: string;
    label?: string;
  }): Promise<{
    walletState: WalletState;
    selectedAccount: WalletAccount;
  }> {
    const currentWalletState = await this.storage.getWalletState();

    const nextAccountsState = accountService.addWatchAccountToState(
      this.toAccountsState(currentWalletState),
      {
        address: input.address as EvmAddress,
        label: input.label,
      },
    );

    const nextWalletState: WalletState = {
      ...currentWalletState,
      selectedAccountId: nextAccountsState.selectedAccountId,
      accounts: nextAccountsState.accounts,
    };

    await this.storage.saveWalletState(nextWalletState);

    const selectedAccount = this.getRequiredSelectedAccount(nextWalletState);

    return {
      walletState: nextWalletState,
      selectedAccount,
    };
  }

  async selectAccount(
    input: SelectAccountInput,
  ): Promise<SelectAccountResult> {
    const currentWalletState = await this.storage.getWalletState();

    const nextAccountsState = accountService.selectAccount(
      this.toAccountsState(currentWalletState),
      input.accountId,
    );

    const nextWalletState: WalletState = {
      ...currentWalletState,
      selectedAccountId: nextAccountsState.selectedAccountId,
      accounts: nextAccountsState.accounts,
    };

    await this.storage.saveWalletState(nextWalletState);

    const selectedAccount = this.getRequiredSelectedAccount(nextWalletState);

    return {
      walletState: nextWalletState,
      selectedAccount,
    };
  }

  async getSelectedBalance(): Promise<GetSelectedBalanceResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    return balanceService.getNativeBalance(
      selectedAccount.address,
      walletState.selectedChainId,
    );
  }

  async getSelectedPortfolio(): Promise<WalletPortfolio> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    return tokenBalanceService.getPortfolio(
      selectedAccount.address,
      walletState.selectedChainId,
    );
  }

  async sendSelectedAsset(
    input: SendSelectedAssetInput,
  ): Promise<SendSelectedAssetResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    const mnemonic = await this.getMnemonicForSensitiveOperation(input.password);
    const privateKey = deriveEvmPrivateKey(mnemonic, selectedAccount.index);

    return sendAssetService.sendAsset({
      asset: input.asset,
      privateKey,
      fromAddress: selectedAccount.address,
      toAddress: input.toAddress,
      amount: input.amount,
      chainId: walletState.selectedChainId,
    });
  }

  async sendSelectedPreparedTransaction(input: {
    transaction: PreparedTransactionRequest;
    waitForReceipt?: boolean;
  }): Promise<SendPreparedTransactionResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    const mnemonic = await this.getMnemonicForSensitiveOperation();
    const privateKey = deriveEvmPrivateKey(mnemonic, selectedAccount.index);

    return sendAssetService.sendPreparedTransaction({
      transaction: input.transaction,
      privateKey,
      fromAddress: selectedAccount.address,
      chainId: walletState.selectedChainId,
      waitForReceipt: input.waitForReceipt,
    });
  }

  async waitForSelectedTransaction(input: {
    hash: string;
    confirmations?: number;
    timeoutMs?: number;
  }): Promise<"confirmed" | "failed"> {
    const walletState = await this.storage.getWalletState();
    const chain = networkService.getRequiredChainById(walletState.selectedChainId);
    const provider = new JsonRpcProvider(chain.rpcUrl);

    const receipt = await provider.waitForTransaction(
      input.hash,
      input.confirmations ?? 1,
      input.timeoutMs ?? 180_000,
    );

    if (!receipt) {
      throw new Error("Transaction confirmation timed out.");
    }

    return receipt.status === 1 ? "confirmed" : "failed";
  }

  async getSelectedTransactionStatus(input: {
    hash: string;
  }): Promise<"submitted" | "confirmed" | "failed"> {
    const walletState = await this.storage.getWalletState();
    const chain = networkService.getRequiredChainById(walletState.selectedChainId);
    const provider = new JsonRpcProvider(chain.rpcUrl);

    const receipt = await provider.getTransactionReceipt(input.hash);

    if (!receipt) {
      return "submitted";
    }

    return receipt.status === 1 ? "confirmed" : "failed";
  }

  async revealSeedPhrase(
    input: RevealSeedPhraseInput,
  ): Promise<RevealSeedPhraseResult> {
    const encryptedVault = await this.getRequiredEncryptedVault();

    const mnemonic = await vaultService.revealMnemonic({
      encryptedVault,
      password: input.password,
    });

    return {
      mnemonic,
    };
  }

  async revealPrivateKey(
    input: RevealPrivateKeyInput,
  ): Promise<RevealPrivateKeyResult> {
    const encryptedVault = await this.getRequiredEncryptedVault();

    const payload = await vaultService.unlockVault({
      encryptedVault,
      password: input.password,
    });

    const walletState = await this.storage.getWalletState();

    const account = input.accountId
      ? this.getRequiredAccountById(walletState, input.accountId)
      : this.getRequiredSelectedAccount(walletState);

    if (account.type === "watch") {
      throw new Error("Watch-only wallet does not have a private key.");
    }

    const privateKey = deriveEvmPrivateKey(payload.mnemonic, account.index);

    return {
      account,
      privateKey,
    };
  }

  async setSelectedChainId(chainId: number): Promise<WalletState> {
    return this.storage.setSelectedChainId(chainId);
  }

  async setBalanceAutoRefreshSeconds(seconds: number): Promise<WalletState> {
    const normalizedSeconds = Math.min(60, Math.max(1, Math.trunc(seconds)));

    return this.storage.updateSettings({
      balanceAutoRefreshSeconds: normalizedSeconds,
    });
  }

  async clearWallet(): Promise<void> {
    this.unlockedVault = null;

    await this.storage.clearWalletData();
  }

  private createInitialWalletState(
    mnemonic: string,
  ): WalletCreateInitialStateResult {
    const accountsState = accountService.createInitialAccountsState(mnemonic);

    const walletState: WalletState = {
      selectedAccountId: accountsState.selectedAccountId,
      selectedChainId: DEFAULT_SELECTED_CHAIN_ID,
      accounts: accountsState.accounts,
      settings: {
        ...DEFAULT_WALLET_SETTINGS,
        biometricUnlock: {
          ...DEFAULT_WALLET_SETTINGS.biometricUnlock,
        },
      },
    };

    return {
      accountsState,
      walletState,
    };
  }

  private async getMnemonicForSensitiveOperation(
    password?: string,
  ): Promise<string> {
    if (this.unlockedVault) {
      return this.unlockedVault.payload.mnemonic;
    }

    if (!password) {
      throw new Error("Password is required.");
    }

    const encryptedVault = await this.getRequiredEncryptedVault();

    const payload = await vaultService.unlockVault({
      encryptedVault,
      password,
    });

    return payload.mnemonic;
  }

  private async getRequiredEncryptedVault(): Promise<EncryptedVault> {
    const encryptedVault = await this.storage.getEncryptedVault();

    if (!encryptedVault) {
      throw new Error("Wallet is not initialized.");
    }

    return encryptedVault;
  }

  private getRuntimeState(
    encryptedVault: EncryptedVault | null,
  ): WalletRuntimeState {
    if (!encryptedVault) {
      return {
        status: "not_initialized",
        unlockedAt: null,
      };
    }

    if (!this.unlockedVault) {
      return {
        status: "locked",
        unlockedAt: null,
      };
    }

    return {
      status: "unlocked",
      unlockedAt: this.unlockedVault.unlockedAt,
    };
  }

  private toAccountsState(walletState: WalletState) {
    return {
      selectedAccountId: walletState.selectedAccountId,
      accounts: walletState.accounts,
    };
  }

  private getRequiredSelectedAccount(walletState: WalletState): WalletAccount {
    const selectedAccount = accountService.getSelectedAccount(
      this.toAccountsState(walletState),
    );

    if (!selectedAccount) {
      throw new Error("Selected account not found.");
    }

    return selectedAccount;
  }

  private getRequiredSelectedAccountFromAccountsState(accountsState: {
    selectedAccountId: WalletAccountId | null;
    accounts: WalletAccount[];
  }): WalletAccount {
    const selectedAccount = accountService.getSelectedAccount(accountsState);

    if (!selectedAccount) {
      throw new Error("Selected account not found.");
    }

    return selectedAccount;
  }

  private getRequiredAccountById(
    walletState: WalletState,
    accountId: WalletAccountId,
  ): WalletAccount {
    const account = walletState.accounts.find((item) => {
      return item.id === accountId;
    });

    if (!account) {
      throw new Error("Account not found.");
    }

    return account;
  }
}

export const walletService = new WalletService();