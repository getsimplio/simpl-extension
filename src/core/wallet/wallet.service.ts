// src/core/wallet/wallet.service.ts

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatUnits,
  getAddress,
  type TypedDataDomain,
  type TypedDataField,
  getBytes,
  isHexString,
} from "ethers";
import { accountService } from "../accounts/account.service";
import type {
  MnemonicWalletAccount,
  WalletAccount,
  WalletAccountId,
} from "../accounts/account.types";
import {
  deriveEvmAccount,
  deriveEvmPrivateKey,
  type EvmAddress,
  type EvmPrivateKey,
} from "../accounts/derivation";
import { balanceService } from "../balances/balance.service";
import { mnemonicService } from "../mnemonic/mnemonic.service";
import { networkService } from "../networks/network.service";
import {
  TRON_MAINNET_CHAIN_ID,
  isTronChainId,
  isBitcoinChainId,
  isSolanaChainId,
  isTonChainId,
} from "../networks/chain-registry";
import {
  getRequiredTonConfigByChainId,
  getTonAddressExplorerUrl,
  TON_MAINNET,
} from "../../chains/ton/ton.config";
import {
  deriveTonAccountFromMnemonic,
  deriveTonKeyPairFromMnemonic,
} from "../../chains/ton/ton.derivation";
import { nanoToTon } from "../../chains/ton/ton.format";
import {
  getTonNativeBalanceNano,
  getTonPortfolio,
  sendTonAsset,
  getTonActivityStatus,
  waitForTonActivity,
} from "../../chains/ton/ton.adapter";
import type { KeyPair } from "@ton/crypto";
import {
  getRequiredSolanaConfigByChainId,
  getSolanaAddressExplorerUrl,
  SOLANA_MAINNET,
  type SolanaChainConfig,
} from "../../chains/solana/solana.config";
import { deriveSolanaAccountFromMnemonic } from "../../chains/solana/solana.derivation";
import { signSolanaSwapTransaction } from "../../chains/solana/solana.swap";
import {
  executeSolanaBridgeTransaction,
  executeWsolSetupTransaction,
} from "../../chains/solana/solana.bridge";
import { lamportsToSol } from "../../chains/solana/solana.format";
import {
  getSolanaActivity,
  getSolanaActivityStatus,
  getSolanaNativeBalanceLamports,
  getSolanaPortfolio,
  sendSolanaAsset,
} from "../../chains/solana/solana.adapter";
import {
  getRequiredBitcoinConfigByChainId,
  getBitcoinAddressExplorerUrl,
  BITCOIN_MAINNET,
  BITCOIN_TESTNET,
  type BitcoinChainConfig,
} from "../../chains/bitcoin/bitcoin.config";
import {
  deriveBitcoinAccount,
  deriveBitcoinKeyFromPrivateKey,
} from "../../chains/bitcoin/bitcoin.derivation";
import {
  getBitcoinActivity,
  getBitcoinActivityStatus,
  getBitcoinNativeBalanceSats,
  getBitcoinPortfolio,
  sendBitcoinAsset,
} from "../../chains/bitcoin/bitcoin.adapter";
import { getBitcoinFeeQuotes } from "../../chains/bitcoin/bitcoin.fees";
import { satsToBtc } from "../../chains/bitcoin/bitcoin.format";
import type { BitcoinSigningKey } from "../../chains/bitcoin/bitcoin.transactions";
import type { BitcoinAccountAddresses } from "../accounts/account.types";
import type { TransactionHistoryItem } from "../transactions/transaction-history.service";
import {
  deriveTronAccount,
  tronAddressFromPrivateKey,
  tronAddressToHex,
} from "../../chains/tron/tron.address";
import {
  signTronTransaction,
  signTronMessage,
  sendSignedTronTransaction,
  type UnsignedTronTransaction,
  type SignedTronTransaction,
} from "../../chains/tron/tron.signer";
import {
  extractTronWcTransaction,
  extractTronWcMessage,
} from "../../chains/tron/tron.wc";
import { tronError } from "../../chains/tron/tron.errors";
import { sunToTrx } from "../../chains/tron/tron.format";
import {
  getTronAddressExplorerUrl,
  getTronTransactionExplorerUrl,
  TRC20_APPROVE_ENERGY_ESTIMATE,
  TRC20_APPROVE_MIN_TRX_SUN,
} from "../../chains/tron/tron.config";
import {
  getTrxBalance,
  getTronAvailableEnergy,
} from "../../chains/tron/tron.balance";
import {
  executeTronBridgeTransaction,
  executeTronBridgeApproval,
} from "../../chains/tron/tron.bridge";
import {
  getTronActivityStatus,
  getTronPortfolio,
  sendTronAsset,
} from "../../chains/tron/tron.adapter";
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
  type WalletAssetBalance,
  type WalletPortfolio,
} from "../tokens/token-balance.service";
import {
  sendAssetService,
  type PreparedTransactionRequest,
  type SendPreparedTransactionResult,
} from "../transactions/send-asset.service";
import { encodeErc20ApproveData } from "../bridge/evm-bridge.service";
import { readErc20Allowance } from "../balances/chain-balance.service";
import { vaultService } from "../vault/vault.service";
import { encryptionService } from "../vault/encryption.service";
import type { EncryptedVault, VaultPayload } from "../vault/vault.types";
const WATCHED_ASSETS_STORAGE_KEY = "watchedAssets";

const ERC20_BALANCE_OF_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
] as const;

type WatchedAssetStorageItem = {
  id?: string;
  type?: string;
  chainId?: number;
  chainNamespace?: string;
  address?: string;
  symbol?: string;
  decimals?: number;
  image?: string;
  name?: string;
  addedAt?: string;
  updatedAt?: string;
};

import type {
  AccountDisplayAddress,
  ExportAccountKeysInput,
  ExportAccountKeysResult,
  ExportedPrivateKey,
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

// Normalize a user-entered private key: trim, add the 0x prefix if missing, and
// validate the 32-byte hex shape. Throws a friendly error otherwise. Never logs
// the value.
function normalizeImportedPrivateKey(input: string): string {
  const trimmed = input.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error("Enter a valid EVM private key.");
  }

  return withPrefix.toLowerCase();
}

function createImportedAccountId(): WalletAccountId {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `imported-${Date.now()}-${Math.floor(performance.now())}`;
}

// Choose which account becomes active after the current one is removed. Prefer
// the primary seed's first account, then the lowest primary index, then any
// remaining signer, then any account at all (e.g. watch-only), else none.
function pickFallbackAccountId(
  accounts: WalletAccount[],
): WalletAccountId | null {
  const primary = accounts
    .filter(
      (account): account is MnemonicWalletAccount =>
        account.type === "mnemonic",
    )
    .sort((a, b) => a.index - b.index);

  if (primary.length > 0) {
    return primary[0].id;
  }

  const signer = accounts.find((account) => account.type !== "watch");
  if (signer) {
    return signer.id;
  }

  return accounts[0]?.id ?? null;
}

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

  // Import an external wallet from a recovery phrase. Adds its first account as
  // a signer. The phrase is stored ONLY inside the encrypted vault (re-encrypted
  // under the existing wallet password, which is required to authorize this).
  async importMnemonicAccount(input: {
    mnemonic: string;
    label?: string;
    password: string;
  }): Promise<{ walletState: WalletState; account: WalletAccount }> {
    const validation = mnemonicService.validateMnemonic(input.mnemonic);

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const mnemonic = validation.mnemonic;
    const derived = deriveEvmAccount(mnemonic, 0);
    const address = getAddress(derived.address) as EvmAddress;

    const walletState = await this.storage.getWalletState();
    this.assertNoDuplicateAddress(walletState, address);

    const payload = await this.unlockPayloadWithPassword(input.password);

    const id = createImportedAccountId();
    const nextPayload: VaultPayload = {
      ...payload,
      importedAccounts: [
        ...(payload.importedAccounts ?? []),
        { id, type: "importedMnemonic", mnemonic, index: 0 },
      ],
    };

    const account: WalletAccount = {
      id,
      type: "importedMnemonic",
      index: 0,
      address,
      label: input.label?.trim() || "Imported wallet",
      derivationPath: derived.derivationPath,
      createdAt: new Date().toISOString(),
    };

    return this.persistImportedAccount(
      walletState,
      account,
      nextPayload,
      input.password,
    );
  }

  // Import an external wallet from a raw EVM private key. Adds one signer
  // account. The key is stored ONLY inside the encrypted vault.
  async importPrivateKeyAccount(input: {
    privateKey: string;
    label?: string;
    password: string;
  }): Promise<{ walletState: WalletState; account: WalletAccount }> {
    const normalizedKey = normalizeImportedPrivateKey(input.privateKey);

    let address: EvmAddress;
    try {
      address = getAddress(new Wallet(normalizedKey).address) as EvmAddress;
    } catch {
      throw new Error("Enter a valid EVM private key.");
    }

    const walletState = await this.storage.getWalletState();
    this.assertNoDuplicateAddress(walletState, address);

    const payload = await this.unlockPayloadWithPassword(input.password);

    const id = createImportedAccountId();
    const nextPayload: VaultPayload = {
      ...payload,
      importedAccounts: [
        ...(payload.importedAccounts ?? []),
        { id, type: "privateKey", privateKey: normalizedKey },
      ],
    };

    const account: WalletAccount = {
      id,
      type: "privateKey",
      index: null,
      address,
      label: input.label?.trim() || "Imported account",
      derivationPath: null,
      createdAt: new Date().toISOString(),
    };

    return this.persistImportedAccount(
      walletState,
      account,
      nextPayload,
      input.password,
    );
  }

  // Decrypt the vault with the supplied password (verifies it before we
  // re-encrypt). Maps a decryption failure to a friendly message.
  private async unlockPayloadWithPassword(
    password: string,
  ): Promise<VaultPayload> {
    const encryptedVault = await this.getRequiredEncryptedVault();

    try {
      return await vaultService.unlockVault({ encryptedVault, password });
    } catch {
      throw new Error("Wrong wallet password.");
    }
  }

  // Re-encrypt the vault with the added secret, append the account, select it,
  // and refresh the in-memory unlocked payload so signing works immediately.
  private async persistImportedAccount(
    walletState: WalletState,
    account: WalletAccount,
    nextPayload: VaultPayload,
    password: string,
  ): Promise<{ walletState: WalletState; account: WalletAccount }> {
    const nextVault = await encryptionService.encryptVaultPayload(
      nextPayload,
      password,
    );

    const nextWalletState: WalletState = {
      ...walletState,
      accounts: [...walletState.accounts, account],
      selectedAccountId: account.id,
    };

    await this.storage.saveStoredWalletData({
      encryptedVault: nextVault,
      walletState: nextWalletState,
    });

    if (this.unlockedVault) {
      this.unlockedVault = {
        payload: nextPayload,
        unlockedAt: this.unlockedVault.unlockedAt,
      };
    }

    return { walletState: nextWalletState, account };
  }

  // Remove an imported signer account (seed phrase or private key). Deletes its
  // encrypted secret from the vault AND its account record — not just a UI hide.
  // Requires the wallet password to re-encrypt the vault. Primary-seed and
  // watch-only accounts are rejected (they use their own flows).
  async removeImportedAccount(input: {
    accountId: WalletAccountId;
    password: string;
  }): Promise<{ walletState: WalletState; selectedAccount: WalletAccount | null }> {
    const walletState = await this.storage.getWalletState();

    const account = walletState.accounts.find(
      (item) => item.id === input.accountId,
    );

    if (!account) {
      throw new Error("Account not found.");
    }

    if (account.type !== "privateKey" && account.type !== "importedMnemonic") {
      throw new Error("Only imported accounts can be removed here.");
    }

    // Verify the password and obtain the decrypted payload to rewrite it.
    const payload = await this.unlockPayloadWithPassword(input.password);

    // Drop this account's encrypted secret, then re-encrypt the vault.
    const nextPayload: VaultPayload = {
      ...payload,
      importedAccounts: (payload.importedAccounts ?? []).filter(
        (secret) => secret.id !== input.accountId,
      ),
    };

    const nextVault = await encryptionService.encryptVaultPayload(
      nextPayload,
      input.password,
    );

    const remainingAccounts = walletState.accounts.filter(
      (item) => item.id !== input.accountId,
    );

    // If the removed account was active, fall back to another account so the
    // selection never points at a deleted address.
    const nextSelectedId =
      walletState.selectedAccountId === input.accountId
        ? pickFallbackAccountId(remainingAccounts)
        : walletState.selectedAccountId;

    const nextWalletState: WalletState = {
      ...walletState,
      accounts: remainingAccounts,
      selectedAccountId: nextSelectedId,
    };

    await this.storage.saveStoredWalletData({
      encryptedVault: nextVault,
      walletState: nextWalletState,
    });

    // Drop the secret from the in-memory unlocked payload too, so the removed
    // account can no longer sign even while the wallet stays unlocked.
    if (this.unlockedVault) {
      this.unlockedVault = {
        payload: nextPayload,
        unlockedAt: this.unlockedVault.unlockedAt,
      };
    }

    const selectedAccount = nextSelectedId
      ? remainingAccounts.find((item) => item.id === nextSelectedId) ?? null
      : null;

    return { walletState: nextWalletState, selectedAccount };
  }

  // Remove a watch-only account. Watch accounts hold no key material, so this
  // only drops the account record (no vault re-encryption). The password is
  // still verified first — removal must never happen without confirmation, and
  // it keeps the UX identical to imported-account removal. Non-watch accounts
  // are rejected (they use removeImportedAccount / the Danger Zone reset).
  async removeWatchAccount(input: {
    accountId: WalletAccountId;
    password: string;
  }): Promise<{ walletState: WalletState; selectedAccount: WalletAccount | null }> {
    const walletState = await this.storage.getWalletState();

    const account = walletState.accounts.find(
      (item) => item.id === input.accountId,
    );

    if (!account) {
      throw new Error("Account not found.");
    }

    if (account.type !== "watch") {
      throw new Error("Only watch-only accounts can be removed here.");
    }

    // Verify the wallet password before touching any account data. We don't need
    // the payload (no secret to drop) — this is purely the confirmation gate.
    await this.unlockPayloadWithPassword(input.password);

    const remainingAccounts = walletState.accounts.filter(
      (item) => item.id !== input.accountId,
    );

    const nextSelectedId =
      walletState.selectedAccountId === input.accountId
        ? pickFallbackAccountId(remainingAccounts)
        : walletState.selectedAccountId;

    const nextWalletState: WalletState = {
      ...walletState,
      accounts: remainingAccounts,
      selectedAccountId: nextSelectedId,
    };

    await this.storage.saveStoredWalletData({
      encryptedVault: await this.getRequiredEncryptedVault(),
      walletState: nextWalletState,
    });

    const selectedAccount = nextSelectedId
      ? remainingAccounts.find((item) => item.id === nextSelectedId) ?? null
      : null;

    return { walletState: nextWalletState, selectedAccount };
  }

  // Reject duplicate imports. A clearer message when the address is already
  // tracked as watch-only (it must be removed before importing as a signer).
  private assertNoDuplicateAddress(
    walletState: WalletState,
    address: string,
  ): void {
    const existing = walletState.accounts.find(
      (item) => item.address.toLowerCase() === address.toLowerCase(),
    );

    if (!existing) return;

    if (existing.type === "watch") {
      throw new Error(
        "This address already exists as watch-only. Remove it first to import as a signer.",
      );
    }

    throw new Error("This account is already added.");
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

  // Update an account's display label. Metadata only — does not touch keys,
  // the encrypted vault, selection, or signing. Label is trimmed and bounded.
  async renameAccount(input: {
    accountId: WalletAccountId;
    label: string;
  }): Promise<{ walletState: WalletState; account: WalletAccount }> {
    const label = input.label.trim();

    if (!label) {
      throw new Error("Account name cannot be empty.");
    }
    if (label.length > 32) {
      throw new Error("Account name must be 32 characters or fewer.");
    }

    const currentWalletState = await this.storage.getWalletState();

    let renamed: WalletAccount | null = null;
    const accounts = currentWalletState.accounts.map((account) => {
      if (account.id !== input.accountId) {
        return account;
      }
      renamed = { ...account, label };
      return renamed;
    });

    if (!renamed) {
      throw new Error("Account not found.");
    }

    const nextWalletState: WalletState = {
      ...currentWalletState,
      accounts,
    };

    await this.storage.saveWalletState(nextWalletState);

    return { walletState: nextWalletState, account: renamed };
  }

  async getSelectedBalance(): Promise<GetSelectedBalanceResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (isTronChainId(walletState.selectedChainId)) {
      const tronAddress = await this.ensureTronAddressForAccount(
        walletState,
        selectedAccount,
      );
      const sun = await getTrxBalance(tronAddress);

      return {
        // Display-only field; TRON uses a base58 address here.
        address: tronAddress as EvmAddress,
        chainId: TRON_MAINNET_CHAIN_ID,
        chainName: "TRON",
        symbol: "TRX",
        decimals: 6,
        balanceWei: sun.toString(),
        formatted: sunToTrx(sun),
        updatedAt: new Date().toISOString(),
      };
    }

    if (isBitcoinChainId(walletState.selectedChainId)) {
      const config = getRequiredBitcoinConfigByChainId(
        walletState.selectedChainId,
      );
      const addresses = await this.ensureBitcoinAddressesForAccount(
        walletState,
        selectedAccount,
        config,
      );
      const sats = await getBitcoinNativeBalanceSats(config, [
        addresses.receive,
        addresses.change,
      ]);

      return {
        // Display-only field; Bitcoin uses the receive address here.
        address: addresses.receive as EvmAddress,
        chainId: config.chainId,
        chainName: config.name,
        symbol: config.symbol,
        decimals: config.decimals,
        balanceWei: sats.toString(),
        formatted: satsToBtc(sats),
        updatedAt: new Date().toISOString(),
      };
    }

    if (isSolanaChainId(walletState.selectedChainId)) {
      const config = getRequiredSolanaConfigByChainId(
        walletState.selectedChainId,
      );
      const address = await this.ensureSolanaAddressForAccount(
        walletState,
        selectedAccount,
      );
      const lamports = await getSolanaNativeBalanceLamports(config, address);

      return {
        // Display-only field; Solana uses its base58 address here.
        address: address as EvmAddress,
        chainId: config.chainId,
        chainName: config.name,
        symbol: config.symbol,
        decimals: config.decimals,
        balanceWei: lamports.toString(),
        formatted: lamportsToSol(lamports),
        updatedAt: new Date().toISOString(),
      };
    }

    if (isTonChainId(walletState.selectedChainId)) {
      const config = getRequiredTonConfigByChainId(
        walletState.selectedChainId,
      );
      const address = await this.ensureTonAddressForAccount(
        walletState,
        selectedAccount,
      );
      const nano = await getTonNativeBalanceNano(config, address);

      return {
        // Display-only field; TON uses its user-friendly address here.
        address: address as EvmAddress,
        chainId: config.chainId,
        chainName: config.name,
        symbol: config.symbol,
        decimals: config.decimals,
        balanceWei: nano.toString(),
        formatted: nanoToTon(nano),
        updatedAt: new Date().toISOString(),
      };
    }

    return balanceService.getNativeBalance(
      selectedAccount.address,
      walletState.selectedChainId,
    );
  }

  async getSelectedPortfolio(): Promise<WalletPortfolio> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (isTronChainId(walletState.selectedChainId)) {
      const tronAddress = await this.ensureTronAddressForAccount(
        walletState,
        selectedAccount,
      );
      const assets = await getTronPortfolio(tronAddress);

      return {
        // Display-only field; TRON uses a base58 address here.
        address: tronAddress as EvmAddress,
        chainId: TRON_MAINNET_CHAIN_ID,
        chainName: "TRON",
        assets,
        updatedAt: new Date().toISOString(),
      };
    }

    if (isBitcoinChainId(walletState.selectedChainId)) {
      const config = getRequiredBitcoinConfigByChainId(
        walletState.selectedChainId,
      );
      const addresses = await this.ensureBitcoinAddressesForAccount(
        walletState,
        selectedAccount,
        config,
      );
      const assets = await getBitcoinPortfolio(config, [
        addresses.receive,
        addresses.change,
      ]);

      return {
        // Display-only field; Bitcoin uses the receive address here.
        address: addresses.receive as EvmAddress,
        chainId: config.chainId,
        chainName: config.name,
        assets,
        updatedAt: new Date().toISOString(),
      };
    }

    if (isSolanaChainId(walletState.selectedChainId)) {
      const config = getRequiredSolanaConfigByChainId(
        walletState.selectedChainId,
      );
      const address = await this.ensureSolanaAddressForAccount(
        walletState,
        selectedAccount,
      );
      const assets = await getSolanaPortfolio(config, address);

      return {
        // Display-only field; Solana uses its base58 address here.
        address: address as EvmAddress,
        chainId: config.chainId,
        chainName: config.name,
        assets,
        updatedAt: new Date().toISOString(),
      };
    }

    if (isTonChainId(walletState.selectedChainId)) {
      const config = getRequiredTonConfigByChainId(
        walletState.selectedChainId,
      );
      const address = await this.ensureTonAddressForAccount(
        walletState,
        selectedAccount,
      );
      const assets = await getTonPortfolio(config, address);

      return {
        // Display-only field; TON uses its user-friendly address here.
        address: address as EvmAddress,
        chainId: config.chainId,
        chainName: config.name,
        assets,
        updatedAt: new Date().toISOString(),
      };
    }

    const portfolio = await tokenBalanceService.getPortfolio(
      selectedAccount.address,
      walletState.selectedChainId,
    );

    const watchedAssets = await this.getWatchedAssetBalances(
      selectedAccount.address,
      walletState.selectedChainId,
    );

    if (watchedAssets.length === 0) {
      return portfolio;
    }

    const existingKeys = new Set(
      portfolio.assets.map((asset) => this.getPortfolioAssetKey(asset)),
    );

    const newWatchedAssets = watchedAssets.filter((asset) => {
      return !existingKeys.has(this.getPortfolioAssetKey(asset));
    });

    if (newWatchedAssets.length === 0) {
      return portfolio;
    }

    return {
      ...portfolio,
      assets: [...portfolio.assets, ...newWatchedAssets],
      updatedAt: new Date().toISOString(),
    };
  }

  async sendSelectedAsset(
    input: SendSelectedAssetInput,
  ): Promise<SendSelectedAssetResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    if (isTronChainId(walletState.selectedChainId)) {
      const tronAddress = await this.ensureTronAddressForAccount(
        walletState,
        selectedAccount,
        input.password,
      );
      const tronPrivateKey = await this.getTronPrivateKeyForAccount(
        selectedAccount,
        input.password,
      );

      return sendTronAsset({
        asset: input.asset,
        privateKey: tronPrivateKey,
        fromAddress: tronAddress,
        toAddress: input.toAddress,
        amount: input.amount,
      });
    }

    if (isBitcoinChainId(walletState.selectedChainId)) {
      return this.sendSelectedBitcoinAsset(walletState, selectedAccount, input);
    }

    if (isSolanaChainId(walletState.selectedChainId)) {
      return this.sendSelectedSolanaAsset(walletState, selectedAccount, input);
    }

    if (isTonChainId(walletState.selectedChainId)) {
      return this.sendSelectedTonAsset(walletState, selectedAccount, input);
    }

    const privateKey = await this.getPrivateKeyForAccount(
      selectedAccount,
      input.password,
    );

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
    password?: string;
  }): Promise<SendPreparedTransactionResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    const privateKey = await this.getPrivateKeyForAccount(
      selectedAccount,
      input.password,
    );

    return sendAssetService.sendPreparedTransaction({
      transaction: input.transaction,
      privateKey,
      fromAddress: selectedAccount.address,
      chainId: walletState.selectedChainId,
      waitForReceipt: input.waitForReceipt,
    });
  }

  // Like sendSelectedPreparedTransaction, but signs + broadcasts on an EXPLICIT
  // chain rather than the globally-selected one. Used by the Bridge flow, whose
  // source chain is chosen independently of the wallet's active network. The
  // chain must be a registry EVM chain (an RPC must exist); the same private
  // key derivation and watch-only guard apply — no vault/seed logic changes.
  async sendPreparedTransactionForChain(input: {
    transaction: PreparedTransactionRequest;
    chainId: number;
    waitForReceipt?: boolean;
    password?: string;
  }): Promise<SendPreparedTransactionResult> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    const privateKey = await this.getPrivateKeyForAccount(
      selectedAccount,
      input.password,
    );

    return sendAssetService.sendPreparedTransaction({
      transaction: input.transaction,
      privateKey,
      fromAddress: selectedAccount.address,
      chainId: input.chainId,
      waitForReceipt: input.waitForReceipt,
    });
  }

  // Approve an ERC-20 source token for a bridge spender (the LI.FI approvalAddress)
  // on an EXPLICIT source chain, then wait for the receipt. Handles USDT-style
  // tokens that reject a non-zero → non-zero approve: if the first approve fails
  // AND a non-zero allowance already exists, it resets the allowance to 0 and
  // re-approves. Scoped to the ERC-20 approval path — the bridge send is separate.
  async executeSelectedEvmBridgeApproval(input: {
    chainId: number;
    tokenAddress: string;
    spender: string;
    amountBaseUnits: string;
    password?: string;
  }): Promise<{ hash: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    const privateKey = await this.getPrivateKeyForAccount(
      selectedAccount,
      input.password,
    );

    const sendApprove = (amountBaseUnits: string) =>
      sendAssetService.sendPreparedTransaction({
        transaction: {
          to: input.tokenAddress,
          data: encodeErc20ApproveData(input.spender, amountBaseUnits),
          value: "0",
        },
        privateKey,
        fromAddress: selectedAccount.address,
        chainId: input.chainId,
        waitForReceipt: true,
      });

    try {
      const res = await sendApprove(input.amountBaseUnits);
      return { hash: res.hash };
    } catch (error) {
      // USDT-style tokens reject approve(nonzero) while a non-zero allowance is
      // already set. If that's the case, reset to 0 first, then re-approve.
      const allowance = await readErc20Allowance({
        chainId: input.chainId,
        tokenAddress: input.tokenAddress,
        owner: selectedAccount.address,
        spender: input.spender,
      }).catch(() => null);
      if (allowance != null && allowance > 0n) {
        await sendApprove("0");
        const res = await sendApprove(input.amountBaseUnits);
        return { hash: res.hash };
      }
      throw error;
    }
  }

  async signSelectedTypedDataV4(input: {
    params: unknown;
    password?: string;
  }): Promise<{ signature: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot sign messages.");
    }

    const params = Array.isArray(input.params) ? input.params : [];
    const from = typeof params[0] === "string" ? params[0] : "";
    const typedDataRaw = params[1];

    if (!from) {
      throw new Error("Typed data signer address is missing.");
    }

    if (from.toLowerCase() !== selectedAccount.address.toLowerCase()) {
      throw new Error("Typed data signer does not match the selected SIMPLE account.");
    }

    const typedData =
      typeof typedDataRaw === "string"
        ? JSON.parse(typedDataRaw)
        : typedDataRaw;

    if (!typedData || typeof typedData !== "object") {
      throw new Error("Typed data payload is invalid.");
    }

    const record = typedData as {
      domain?: Record<string, unknown>;
      types?: Record<string, Array<Record<string, unknown>>>;
      message?: Record<string, unknown>;
      primaryType?: string;
    };

    if (!record.domain || !record.types || !record.message) {
      throw new Error("Typed data payload is missing domain, types or message.");
    }

    const { EIP712Domain: _domainType, ...rawTypes } = record.types;

    const types: Record<string, TypedDataField[]> = {};

    for (const [typeName, fields] of Object.entries(rawTypes)) {
      if (!Array.isArray(fields)) {
        throw new Error(`Typed data type ${typeName} is invalid.`);
      }

      types[typeName] = fields.map((field) => {
        const fieldRecord = field as Record<string, unknown>;
        const name = fieldRecord.name;
        const type = fieldRecord.type;

        if (typeof name !== "string" || !name) {
          throw new Error(`Typed data field name is invalid in ${typeName}.`);
        }

        if (typeof type !== "string" || !type) {
          throw new Error(`Typed data field type is invalid in ${typeName}.`);
        }

        return {
          name,
          type,
        };
      });
    }

    const privateKey = await this.getPrivateKeyForAccount(
      selectedAccount,
      input.password,
    );
    const signer = new Wallet(privateKey);

    const signature = await signer.signTypedData(
      record.domain as TypedDataDomain,
      types,
      record.message,
    );

    return {
      signature,
    };
  }

  async waitForSelectedTransaction(input: {
    hash: string;
    confirmations?: number;
    timeoutMs?: number;
  }): Promise<"confirmed" | "failed"> {
    const walletState = await this.storage.getWalletState();

    if (isTronChainId(walletState.selectedChainId)) {
      return this.waitForTronTransaction(
        input.hash,
        input.timeoutMs ?? 180_000,
      );
    }

    if (isBitcoinChainId(walletState.selectedChainId)) {
      return this.waitForBitcoinTransaction(
        getRequiredBitcoinConfigByChainId(walletState.selectedChainId),
        input.hash,
        input.timeoutMs ?? 180_000,
      );
    }

    if (isSolanaChainId(walletState.selectedChainId)) {
      return this.waitForSolanaTransaction(
        getRequiredSolanaConfigByChainId(walletState.selectedChainId),
        input.hash,
        input.timeoutMs ?? 180_000,
      );
    }

    if (isTonChainId(walletState.selectedChainId)) {
      return waitForTonActivity(
        getRequiredTonConfigByChainId(walletState.selectedChainId),
        this.getSelectedTonAddress(walletState),
        input.hash,
        input.timeoutMs ?? 180_000,
      );
    }

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

    if (isTronChainId(walletState.selectedChainId)) {
      return getTronActivityStatus(input.hash);
    }

    if (isBitcoinChainId(walletState.selectedChainId)) {
      return getBitcoinActivityStatus(
        getRequiredBitcoinConfigByChainId(walletState.selectedChainId),
        input.hash,
      );
    }

    if (isSolanaChainId(walletState.selectedChainId)) {
      return getSolanaActivityStatus(
        getRequiredSolanaConfigByChainId(walletState.selectedChainId),
        input.hash,
      );
    }

    if (isTonChainId(walletState.selectedChainId)) {
      return getTonActivityStatus(
        getRequiredTonConfigByChainId(walletState.selectedChainId),
        this.getSelectedTonAddress(walletState),
        input.hash,
      );
    }

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

    let privateKey: EvmPrivateKey;

    if (account.type === "mnemonic") {
      privateKey = deriveEvmPrivateKey(payload.mnemonic, account.index);
    } else {
      const secret = (payload.importedAccounts ?? []).find(
        (item) => item.id === account.id,
      );

      if (!secret) {
        throw new Error(
          "Key material for this imported account is missing. Re-import the account.",
        );
      }

      privateKey =
        secret.type === "privateKey"
          ? (secret.privateKey as EvmPrivateKey)
          : deriveEvmAccount(secret.mnemonic, secret.index).privateKey;
    }

    return {
      account,
      privateKey,
    };
  }

  // Export the private key(s) for an account AFTER verifying the wallet
  // password. Mnemonic-derived accounts yield both an EVM key (m/44'/60') and a
  // TRON key (m/44'/195'). A private-key import yields the single secp256k1 key,
  // which controls both its EVM and TRON addresses. Watch-only accounts have no
  // key. Returned values are never persisted; the caller must clear them.
  async exportAccountKeys(
    input: ExportAccountKeysInput,
  ): Promise<ExportAccountKeysResult> {
    const encryptedVault = await this.getRequiredEncryptedVault();

    let payload: VaultPayload;
    try {
      payload = await vaultService.unlockVault({
        encryptedVault,
        password: input.password,
      });
    } catch {
      throw new Error("Wrong wallet password.");
    }

    const walletState = await this.storage.getWalletState();
    const account = input.accountId
      ? this.getRequiredAccountById(walletState, input.accountId)
      : this.getRequiredSelectedAccount(walletState);

    if (account.type === "watch") {
      throw new Error("Watch-only accounts do not have a private key.");
    }

    const keys: ExportedPrivateKey[] = [];

    if (account.type === "mnemonic" || account.type === "importedMnemonic") {
      let evmPrivateKey: string;

      if (account.type === "mnemonic") {
        evmPrivateKey = deriveEvmPrivateKey(payload.mnemonic, account.index);
      } else {
        const secret = (payload.importedAccounts ?? []).find(
          (item) => item.id === account.id,
        );

        if (!secret || secret.type !== "importedMnemonic") {
          throw new Error(
            "Key material for this imported account is missing. Re-import the account.",
          );
        }

        evmPrivateKey = deriveEvmAccount(
          secret.mnemonic,
          secret.index,
        ).privateKey;
      }

      keys.push({
        family: "evm",
        label: "EVM private key",
        privateKey: evmPrivateKey,
      });

      const tron = this.deriveTronMaterialForAccount(account, payload);
      keys.push({
        family: "tron",
        label: "TRON private key",
        privateKey: tron.privateKey,
      });

      return { account, keys };
    }

    // Private-key import: one secp256k1 key backs both chains' addresses.
    const secret = (payload.importedAccounts ?? []).find(
      (item) => item.id === account.id,
    );

    if (!secret || secret.type !== "privateKey") {
      throw new Error(
        "Key material for this imported account is missing. Re-import the account.",
      );
    }

    keys.push({
      family: "shared",
      label: "Private key",
      privateKey: secret.privateKey,
      note: "This key controls both the EVM and TRON addresses for this account.",
    });

    return { account, keys };
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

    // Wipe ALL wallet-scoped local data (vault, accounts, custom tokens, hidden
    // overrides, history, portfolio/price caches, watched assets), not just the
    // vault + wallet state — so a freshly created/imported wallet never inherits
    // the previous wallet's tokens, balances or activity.
    await this.storage.clearWalletScopedStorage();
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

  async signSelectedPersonalMessage(input: {
    password?: string;
    params: unknown;
  }): Promise<{ signature: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);
    const selectedAddress = selectedAccount.address.toLowerCase();

    const params = Array.isArray(input.params) ? input.params : [];
    const stringParams = params.filter((item): item is string => {
      return typeof item === "string" && item.length > 0;
    });

    if (stringParams.length === 0) {
      throw new Error("personal_sign message is missing.");
    }

    const addressParam = stringParams.find((item) => {
      return /^0x[a-fA-F0-9]{40}$/.test(item);
    });

    if (addressParam && addressParam.toLowerCase() !== selectedAddress) {
      throw new Error("personal_sign address does not match selected account.");
    }

    const message =
      stringParams.find((item) => item !== addressParam) ?? stringParams[0];

    if (!message) {
      throw new Error("personal_sign message is missing.");
    }

    const privateKey = await this.getPrivateKeyForAccount(
      selectedAccount,
      input.password,
    );
    const signer = new Wallet(privateKey);

    if (signer.address.toLowerCase() !== selectedAddress) {
      throw new Error("Derived signer does not match selected account.");
    }

    const normalizedMessage = isHexString(message) ? getBytes(message) : message;
    const signature = await signer.signMessage(normalizedMessage);

    return {
      signature,
    };
  }

  private async getWatchedAssetBalances(
    ownerAddress: EvmAddress,
    chainId: number,
  ): Promise<WalletAssetBalance[]> {
    const watchedAssets = await this.readWatchedAssets();
    const chain = networkService.getRequiredChainById(chainId);

    const tokens = watchedAssets.filter((asset) => {
      return (
        asset.chainId === chainId &&
        asset.type?.toUpperCase() === "ERC20" &&
        typeof asset.address === "string" &&
        asset.address.startsWith("0x") &&
        typeof asset.symbol === "string" &&
        asset.symbol.trim().length > 0 &&
        typeof asset.decimals === "number" &&
        Number.isInteger(asset.decimals) &&
        asset.decimals >= 0 &&
        asset.decimals <= 255
      );
    });

    if (tokens.length === 0) {
      return [];
    }

    const provider = new JsonRpcProvider(chain.rpcUrl, chain.chainId);

    const settledResults = await Promise.allSettled(
      tokens.map(async (asset): Promise<WalletAssetBalance> => {
        const address = asset.address as `0x${string}`;
        const decimals = asset.decimals ?? 18;
        const contract = new Contract(address, ERC20_BALANCE_OF_ABI, provider);
        const rawBalance = (await contract.balanceOf(ownerAddress)) as bigint;
        const rawBalanceString = rawBalance.toString();
        const symbol = asset.symbol?.trim() || "TOKEN";
        const name = asset.name?.trim() || symbol;

        return {
          id: `erc20:${chainId}:${address.toLowerCase()}`,
          type: "erc20",
          chainId,
          chainName: chain.name,
          name,
          symbol,
          decimals,
          contractAddress: address,
          balanceRaw: rawBalanceString,
          formatted: formatUnits(rawBalance, decimals),
          updatedAt: new Date().toISOString(),
          isTransferable: true,
          visible: true,
          usdPrice: null,
          usdValue: null,
          logoUrl: asset.image ?? null,
          isSpam: false,
          isVerified: false,
          source: "watched",
        };
      }),
    );

    return settledResults.flatMap((result) => {
      if (result.status === "fulfilled") {
        return [result.value];
      }

      console.debug("Failed to load watched asset balance:", result.reason);
      return [];
    });
  }

  private async readWatchedAssets(): Promise<WatchedAssetStorageItem[]> {
    const chromeLike = (globalThis as unknown as {
      chrome?: {
        storage?: {
          local?: {
            get?: (
              keys: string | string[],
            ) => Promise<Record<string, unknown>>;
          };
        };
      };
    }).chrome;

    if (typeof chromeLike?.storage?.local?.get !== "function") {
      return [];
    }

    try {
      const stored = await chromeLike.storage.local.get(WATCHED_ASSETS_STORAGE_KEY);
      const value = stored[WATCHED_ASSETS_STORAGE_KEY];

      if (!Array.isArray(value)) {
        return [];
      }

      return value.filter((item): item is WatchedAssetStorageItem => {
        return Boolean(item) && typeof item === "object";
      });
    } catch (error) {
      console.debug("Failed to read watched assets:", error);
      return [];
    }
  }

  private getPortfolioAssetKey(asset: WalletAssetBalance): string {
    if (asset.type === "native") {
      return `native:${asset.chainId}`;
    }

    return `erc20:${asset.chainId}:${asset.contractAddress?.toLowerCase() ?? ""}`;
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

  // Full decrypted vault payload (mnemonic + imported secrets) for operations
  // that may need imported key material. Uses the in-memory unlocked vault when
  // available, otherwise decrypts with the supplied password.
  private async getDecryptedPayloadForSensitiveOperation(
    password?: string,
  ): Promise<VaultPayload> {
    if (this.unlockedVault) {
      return this.unlockedVault.payload;
    }

    if (!password) {
      throw new Error("Password is required.");
    }

    const encryptedVault = await this.getRequiredEncryptedVault();

    return vaultService.unlockVault({ encryptedVault, password });
  }

  // Resolve the signing private key for ANY signer account, regardless of
  // source. Watch-only accounts throw. The private material never leaves this
  // method's caller chain and is never persisted in plaintext.
  private async getPrivateKeyForAccount(
    account: WalletAccount,
    password?: string,
  ): Promise<EvmPrivateKey> {
    if (account.type === "watch") {
      throw new Error("Watch-only wallet cannot sign transactions.");
    }

    const payload =
      await this.getDecryptedPayloadForSensitiveOperation(password);

    // Primary-seed account: re-derive from the wallet mnemonic by index.
    if (account.type === "mnemonic") {
      return deriveEvmPrivateKey(payload.mnemonic, account.index);
    }

    // Imported account: look up its secret in the encrypted vault by id.
    const secret = (payload.importedAccounts ?? []).find(
      (item) => item.id === account.id,
    );

    if (!secret) {
      throw new Error(
        "Key material for this imported account is missing. Re-import the account.",
      );
    }

    if (secret.type === "privateKey") {
      return secret.privateKey as EvmPrivateKey;
    }

    return deriveEvmAccount(secret.mnemonic, secret.index).privateKey;
  }

  // --- TRON ----------------------------------------------------------------

  // Public: resolve the active account's TRON base58 (T…) address for the bridge
  // flow. Returns the persisted value when present; otherwise derives it from the
  // vault and persists it (lazy migration for accounts created before TRON
  // support) — using the SAME m/44'/195' derivation as every other TRON path,
  // never a second one. Uses the in-memory unlocked vault, so it does not prompt
  // for a password while the popup is unlocked. Returns null for watch-only
  // accounts (TRON is unavailable for them).
  async getSelectedTronAddress(password?: string): Promise<string | null> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);
    if (selectedAccount.type === "watch") {
      return null;
    }
    return this.ensureTronAddressForAccount(
      walletState,
      selectedAccount,
      password,
    );
  }

  // Resolve the selected account's TRON address. Returns the persisted value
  // when present (no vault needed); otherwise derives it from the vault and
  // persists it on the account (lazy migration for accounts created before
  // TRON support). Requires the wallet to be unlocked or a password.
  private async ensureTronAddressForAccount(
    walletState: WalletState,
    account: WalletAccount,
    password?: string,
  ): Promise<string> {
    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.tronAddress
    ) {
      return account.tronAddress;
    }

    if (account.type === "watch") {
      throw new Error("Watch-only accounts do not support TRON.");
    }

    const payload =
      await this.getDecryptedPayloadForSensitiveOperation(password);
    const { address } = this.deriveTronMaterialForAccount(account, payload);

    if (account.type === "mnemonic" || account.type === "importedMnemonic") {
      await this.persistTronAddress(walletState, account.id, address);
    }

    return address;
  }

  // Derive the TRON address + signing key for an account from decrypted vault
  // material. Mnemonic-derived accounts use m/44'/195'/0'/0/index; private-key
  // imports reuse the same secp256k1 key as their EVM address.
  private deriveTronMaterialForAccount(
    account: WalletAccount,
    payload: VaultPayload,
  ): { address: string; privateKey: string } {
    if (account.type === "mnemonic") {
      const derived = deriveTronAccount(payload.mnemonic, account.index);
      return { address: derived.address, privateKey: derived.privateKey };
    }

    if (account.type === "importedMnemonic" || account.type === "privateKey") {
      const secret = (payload.importedAccounts ?? []).find(
        (item) => item.id === account.id,
      );

      if (!secret) {
        throw new Error(
          "Key material for this imported account is missing. Re-import the account.",
        );
      }

      if (secret.type === "importedMnemonic") {
        const derived = deriveTronAccount(secret.mnemonic, secret.index);
        return { address: derived.address, privateKey: derived.privateKey };
      }

      const privateKey = secret.privateKey.startsWith("0x")
        ? secret.privateKey.slice(2)
        : secret.privateKey;

      return {
        address: tronAddressFromPrivateKey(secret.privateKey),
        privateKey,
      };
    }

    throw new Error("Watch-only accounts do not support TRON.");
  }

  private async getTronPrivateKeyForAccount(
    account: WalletAccount,
    password?: string,
  ): Promise<string> {
    if (account.type === "watch") {
      throw new Error("Watch-only wallet cannot send transactions.");
    }

    const payload =
      await this.getDecryptedPayloadForSensitiveOperation(password);

    return this.deriveTronMaterialForAccount(account, payload).privateKey;
  }

  private async persistTronAddress(
    walletState: WalletState,
    accountId: WalletAccountId,
    tronAddress: string,
  ): Promise<void> {
    const accounts = walletState.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      if (account.type === "mnemonic" || account.type === "importedMnemonic") {
        return { ...account, tronAddress };
      }

      return account;
    });

    await this.storage.saveWalletState({ ...walletState, accounts });
  }

  private async waitForTronTransaction(
    txId: string,
    timeoutMs: number,
  ): Promise<"confirmed" | "failed"> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await getTronActivityStatus(txId);

      if (status === "confirmed") return "confirmed";
      if (status === "failed") return "failed";

      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    throw new Error("Transaction confirmation timed out.");
  }

  // --- Bitcoin (UTXO) ------------------------------------------------------

  // Resolve the selected account's Bitcoin receive + change addresses for the
  // given network. Returns the persisted pair when present (no vault needed);
  // otherwise derives them from the vault and persists them on the account
  // (lazy migration), mirroring the TRON path. Requires the wallet to be
  // unlocked or a password. Watch-only accounts have no derivable BTC address.
  private async ensureBitcoinAddressesForAccount(
    walletState: WalletState,
    account: WalletAccount,
    config: BitcoinChainConfig,
    password?: string,
  ): Promise<BitcoinAccountAddresses> {
    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.bitcoinAddresses?.[config.chainId]
    ) {
      return account.bitcoinAddresses[config.chainId];
    }

    if (account.type === "watch") {
      throw new Error("Watch-only accounts do not support Bitcoin.");
    }

    const payload =
      await this.getDecryptedPayloadForSensitiveOperation(password);
    const material = this.deriveBitcoinMaterialForAccount(
      account,
      config,
      payload,
    );

    const addresses: BitcoinAccountAddresses = {
      receive: material.receive.address,
      change: material.change.address,
    };

    if (account.type === "mnemonic" || account.type === "importedMnemonic") {
      await this.persistBitcoinAddresses(
        walletState,
        account.id,
        config.chainId,
        addresses,
      );
    }

    return addresses;
  }

  // Derive the Bitcoin receive + change addresses and their signing keys for an
  // account from decrypted vault material. Mnemonic-derived accounts use BIP-84
  // (m/84'/coin'/index'/{0|1}/0); private-key imports have no HD tree, so a
  // single P2WPKH key backs both the receive and change slots.
  //
  // SECURITY: returns Uint8Array private keys held transiently inside this
  // method's caller chain only — never logged, never persisted, never returned
  // to the UI.
  private deriveBitcoinMaterialForAccount(
    account: WalletAccount,
    config: BitcoinChainConfig,
    payload: VaultPayload,
  ): {
    receive: { address: string; privateKey: Uint8Array };
    change: { address: string; privateKey: Uint8Array };
  } {
    if (account.type === "mnemonic") {
      const derived = deriveBitcoinAccount(
        payload.mnemonic,
        config,
        account.index,
      );
      return {
        receive: {
          address: derived.receive.address,
          privateKey: derived.receive.privateKey,
        },
        change: {
          address: derived.change.address,
          privateKey: derived.change.privateKey,
        },
      };
    }

    if (account.type === "importedMnemonic" || account.type === "privateKey") {
      const secret = (payload.importedAccounts ?? []).find(
        (item) => item.id === account.id,
      );

      if (!secret) {
        throw new Error(
          "Key material for this imported account is missing. Re-import the account.",
        );
      }

      if (secret.type === "importedMnemonic") {
        const derived = deriveBitcoinAccount(
          secret.mnemonic,
          config,
          secret.index,
        );
        return {
          receive: {
            address: derived.receive.address,
            privateKey: derived.receive.privateKey,
          },
          change: {
            address: derived.change.address,
            privateKey: derived.change.privateKey,
          },
        };
      }

      // Single imported raw key: one P2WPKH address for both receive + change.
      const single = deriveBitcoinKeyFromPrivateKey(secret.privateKey, config);
      return {
        receive: { address: single.address, privateKey: single.privateKey },
        change: { address: single.address, privateKey: single.privateKey },
      };
    }

    throw new Error("Watch-only accounts do not support Bitcoin.");
  }

  // Orchestrate a Bitcoin send: derive signing material, then hand off to the
  // adapter which loads UTXOs, selects coins, builds + signs the PSBT and
  // broadcasts. The fee rate comes from the send form (sat/vB); when omitted we
  // fall back to a "normal" provider/fallback quote.
  private async sendSelectedBitcoinAsset(
    walletState: WalletState,
    account: WalletAccount,
    input: SendSelectedAssetInput,
  ): Promise<SendSelectedAssetResult> {
    const config = getRequiredBitcoinConfigByChainId(
      walletState.selectedChainId,
    );

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const material = this.deriveBitcoinMaterialForAccount(
      account,
      config,
      payload,
    );

    const feeRateSatPerVb =
      input.feeRateSatPerVb ??
      (await getBitcoinFeeQuotes(config)).normal.satPerVb;

    // De-duplicate addresses/keys (privateKey imports use one address for both).
    const ownedAddresses = Array.from(
      new Set([material.receive.address, material.change.address]),
    );
    const signingKeys: BitcoinSigningKey[] = [
      { address: material.receive.address, privateKey: material.receive.privateKey },
    ];
    if (material.change.address !== material.receive.address) {
      signingKeys.push({
        address: material.change.address,
        privateKey: material.change.privateKey,
      });
    }

    return sendBitcoinAsset({
      config,
      amount: input.amount,
      recipient: input.toAddress,
      feeRateSatPerVb,
      ownedAddresses,
      changeAddress: material.change.address,
      signingKeys,
    });
  }

  // Live Bitcoin activity for the selected account, mapped onto the wallet's
  // shared history-item shape so the Activity screen can render it like EVM/TRON
  // entries. Returns [] for non-BTC chains or when the BTC addresses can't be
  // resolved (e.g. locked + not yet persisted) — the caller still shows any
  // locally recorded sends.
  async getSelectedBitcoinActivity(): Promise<TransactionHistoryItem[]> {
    const walletState = await this.storage.getWalletState();

    if (!isBitcoinChainId(walletState.selectedChainId)) {
      return [];
    }

    const account = this.getRequiredSelectedAccount(walletState);
    const config = getRequiredBitcoinConfigByChainId(
      walletState.selectedChainId,
    );

    let addresses: BitcoinAccountAddresses;
    try {
      addresses = await this.ensureBitcoinAddressesForAccount(
        walletState,
        account,
        config,
      );
    } catch {
      return [];
    }

    const activity = await getBitcoinActivity(config, [
      addresses.receive,
      addresses.change,
    ]);

    return activity.map((item) => {
      const createdAt = item.blockTime
        ? new Date(item.blockTime * 1000).toISOString()
        : new Date().toISOString();

      return {
        id: `${config.chainId}:${item.txid.toLowerCase()}`,
        hash: item.txid,
        chainId: config.chainId,
        chainName: config.name,
        direction: item.direction === "incoming" ? "receive" : "send",
        status: item.confirmed ? "confirmed" : "submitted",
        assetType: "native",
        assetSymbol: config.symbol,
        assetName: config.name,
        contractAddress: null,
        amount: satsToBtc(item.amountSats),
        // Both endpoints are the wallet's own receive address for filtering
        // purposes; the row renders by direction + amount, not address.
        fromAddress: addresses.receive,
        toAddress: addresses.receive,
        explorerUrl: item.explorerUrl,
        createdAt,
        updatedAt: createdAt,
      };
    });
  }

  private async persistBitcoinAddresses(
    walletState: WalletState,
    accountId: WalletAccountId,
    chainId: number,
    addresses: BitcoinAccountAddresses,
  ): Promise<void> {
    const accounts = walletState.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      if (account.type === "mnemonic" || account.type === "importedMnemonic") {
        return {
          ...account,
          bitcoinAddresses: {
            ...account.bitcoinAddresses,
            [chainId]: addresses,
          },
        };
      }

      return account;
    });

    await this.storage.saveWalletState({ ...walletState, accounts });
  }

  private async waitForBitcoinTransaction(
    config: BitcoinChainConfig,
    txid: string,
    timeoutMs: number,
  ): Promise<"confirmed" | "failed"> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await getBitcoinActivityStatus(config, txid);

      if (status === "confirmed") return "confirmed";
      if (status === "failed") return "failed";

      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    throw new Error("Transaction confirmation timed out.");
  }

  // --- Solana (Ed25519) ----------------------------------------------------

  // Resolve the selected account's Solana base58 address. Returns the persisted
  // value when present (no vault needed); otherwise derives it from the vault
  // and persists it on the account (lazy migration, mirroring the TRON path).
  // Requires the wallet to be unlocked or a password. Watch-only and private-key
  // imports have no Ed25519 Solana key.
  private async ensureSolanaAddressForAccount(
    walletState: WalletState,
    account: WalletAccount,
    password?: string,
  ): Promise<string> {
    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.solanaAddress
    ) {
      return account.solanaAddress;
    }

    if (account.type === "watch") {
      throw new Error("Watch-only accounts do not support Solana.");
    }

    if (account.type === "privateKey") {
      throw new Error(
        "Private-key imports do not support Solana (Solana uses Ed25519, not the imported secp256k1 key).",
      );
    }

    const payload =
      await this.getDecryptedPayloadForSensitiveOperation(password);
    const { address } = this.deriveSolanaMaterialForAccount(account, payload);

    await this.persistSolanaAddress(walletState, account.id, address);

    return address;
  }

  // Derive the Solana address + signing material for an account from decrypted
  // vault material. Only mnemonic-derivable accounts are supported: primary-seed
  // accounts use m/44'/501'/index'/0'; imported recovery phrases use the same
  // path on their own seed. Private-key imports (secp256k1) and watch-only
  // accounts have no Ed25519 Solana key.
  //
  // SECURITY: returns a Uint8Array secret key held transiently inside this
  // method's caller chain only — never logged, never persisted, never returned
  // to the UI.
  private deriveSolanaMaterialForAccount(
    account: WalletAccount,
    payload: VaultPayload,
  ): { address: string; secretKey: Uint8Array } {
    if (account.type === "mnemonic") {
      const derived = deriveSolanaAccountFromMnemonic(
        payload.mnemonic,
        account.index,
      );
      return { address: derived.address, secretKey: derived.secretKey };
    }

    if (account.type === "importedMnemonic") {
      const secret = (payload.importedAccounts ?? []).find(
        (item) => item.id === account.id,
      );

      if (!secret) {
        throw new Error(
          "Key material for this imported account is missing. Re-import the account.",
        );
      }

      if (secret.type === "importedMnemonic") {
        const derived = deriveSolanaAccountFromMnemonic(
          secret.mnemonic,
          secret.index,
        );
        return { address: derived.address, secretKey: derived.secretKey };
      }
    }

    throw new Error(
      "This account type does not support Solana. Use a recovery-phrase account.",
    );
  }

  // Orchestrate a Solana send: derive signing material, then hand off to the
  // adapter which validates, balance-checks, builds + signs the transfer and
  // broadcasts. SPL token sends are gated in the adapter with a coded error.
  private async sendSelectedSolanaAsset(
    walletState: WalletState,
    account: WalletAccount,
    input: SendSelectedAssetInput,
  ): Promise<SendSelectedAssetResult> {
    const config = getRequiredSolanaConfigByChainId(
      walletState.selectedChainId,
    );

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const material = this.deriveSolanaMaterialForAccount(account, payload);

    return sendSolanaAsset({
      config,
      asset: input.asset,
      amount: input.amount,
      recipient: input.toAddress,
      fromSecretKey: material.secretKey,
    });
  }

  // --- TON (Ed25519, smart-contract wallet) --------------------------------

  // Resolve the selected account's TON address (user-friendly UQ… form).
  // Returns the persisted value when present (no vault needed); otherwise
  // derives it from the vault and persists it on the account (lazy migration,
  // mirroring the Solana path). Requires the wallet to be unlocked or a
  // password. Watch-only and private-key imports have no Ed25519 TON key.
  private async ensureTonAddressForAccount(
    walletState: WalletState,
    account: WalletAccount,
    password?: string,
  ): Promise<string> {
    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.tonAddress
    ) {
      return account.tonAddress;
    }

    if (account.type === "watch") {
      throw new Error("Watch-only accounts do not support TON.");
    }

    if (account.type === "privateKey") {
      throw new Error(
        "Private-key imports do not support TON (TON uses Ed25519, not the imported secp256k1 key).",
      );
    }

    const payload =
      await this.getDecryptedPayloadForSensitiveOperation(password);
    const address = this.deriveTonAddressForAccount(account, payload);

    await this.persistTonAddress(walletState, account.id, address);

    return address;
  }

  // Derive the TON address for an account from decrypted vault material. Only
  // mnemonic-derivable accounts are supported: primary-seed accounts use
  // m/44'/607'/index'/0'; imported recovery phrases use the same path on their
  // own seed. Receive-only — this returns the PUBLIC address only and never
  // holds or returns secret key material.
  private deriveTonAddressForAccount(
    account: WalletAccount,
    payload: VaultPayload,
  ): string {
    if (account.type === "mnemonic") {
      return deriveTonAccountFromMnemonic(payload.mnemonic, account.index)
        .address;
    }

    if (account.type === "importedMnemonic") {
      const secret = (payload.importedAccounts ?? []).find(
        (item) => item.id === account.id,
      );

      if (!secret) {
        throw new Error(
          "Key material for this imported account is missing. Re-import the account.",
        );
      }

      if (secret.type === "importedMnemonic") {
        return deriveTonAccountFromMnemonic(secret.mnemonic, secret.index)
          .address;
      }
    }

    throw new Error(
      "This account type does not support TON. Use a recovery-phrase account.",
    );
  }

  // Derive the TON signing material (Ed25519 key pair + address) for an account
  // from decrypted vault material. Only mnemonic-derivable accounts are
  // supported (TON uses Ed25519, so private-key imports and watch-only accounts
  // have no TON key).
  //
  // SECURITY: the returned keyPair.secretKey is signing material held transiently
  // inside this method's caller chain only — never logged, persisted or returned
  // to the UI.
  private deriveTonMaterialForAccount(
    account: WalletAccount,
    payload: VaultPayload,
  ): { keyPair: KeyPair; address: string } {
    if (account.type === "mnemonic") {
      const derived = deriveTonKeyPairFromMnemonic(
        payload.mnemonic,
        account.index,
      );
      return { keyPair: derived.keyPair, address: derived.address };
    }

    if (account.type === "importedMnemonic") {
      const secret = (payload.importedAccounts ?? []).find(
        (item) => item.id === account.id,
      );

      if (!secret) {
        throw new Error(
          "Key material for this imported account is missing. Re-import the account.",
        );
      }

      if (secret.type === "importedMnemonic") {
        const derived = deriveTonKeyPairFromMnemonic(
          secret.mnemonic,
          secret.index,
        );
        return { keyPair: derived.keyPair, address: derived.address };
      }
    }

    throw new Error(
      "This account type does not support TON. Use a recovery-phrase account.",
    );
  }

  // Orchestrate a native TON send: derive signing material + the sender address,
  // then hand off to the adapter which does the balance/fee/seqno checks, builds
  // + signs the transfer and broadcasts it. Jetton sends are refused in the
  // adapter with a coded error (out of scope this PR).
  private async sendSelectedTonAsset(
    walletState: WalletState,
    account: WalletAccount,
    input: SendSelectedAssetInput,
  ): Promise<SendSelectedAssetResult> {
    const config = getRequiredTonConfigByChainId(walletState.selectedChainId);

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const material = this.deriveTonMaterialForAccount(account, payload);

    return sendTonAsset({
      config,
      asset: input.asset,
      amount: input.amount,
      recipient: input.toAddress,
      fromAddress: material.address,
      keyPair: material.keyPair,
    });
  }

  private async persistTonAddress(
    walletState: WalletState,
    accountId: WalletAccountId,
    tonAddress: string,
  ): Promise<void> {
    const accounts = walletState.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      if (account.type === "mnemonic" || account.type === "importedMnemonic") {
        return { ...account, tonAddress };
      }

      return account;
    });

    await this.storage.saveWalletState({ ...walletState, accounts });
  }

  // Resolve a TON address for display: the persisted value if present, else
  // derive from the vault when unlocked. Watch-only / private-key → none.
  // Display-only: no key material is held or persisted here.
  // Selected account's cached TON address for read-only status reconciliation
  // (the Simpl proxy needs the sender account to locate a sent message). Uses
  // only the persisted public address — no vault decryption — and returns "" if
  // unavailable, which getTonActivityStatus treats as a safe "submitted".
  private getSelectedTonAddress(walletState: WalletState): string {
    const account = accountService.getSelectedAccount(
      this.toAccountsState(walletState),
    );
    if (!account) return "";
    return this.resolveTonDisplayAddress(account, null) ?? "";
  }

  private resolveTonDisplayAddress(
    account: WalletAccount,
    payload: VaultPayload | null,
  ): string | null {
    if (account.type === "watch" || account.type === "privateKey") {
      return null;
    }

    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.tonAddress
    ) {
      return account.tonAddress;
    }

    if (!payload) {
      return null;
    }

    try {
      return this.deriveTonAddressForAccount(account, payload);
    } catch {
      return null;
    }
  }

  // Sign a Simpl-API/Jupiter swap transaction locally for the selected Solana
  // account. The backend builds the UNSIGNED transaction (base64); this signs it
  // with the account's Solana keypair and returns the signed base64 transaction
  // for /v1/solana/swap/execute. The secret key never leaves the wallet service.
  async signSelectedSolanaSwapTransaction(input: {
    transactionBase64: string;
    password?: string;
  }): Promise<{ signedTransaction: string; address: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot sign transactions.");
    }
    if (!isSolanaChainId(walletState.selectedChainId)) {
      throw new Error("Solana swaps require a Solana network.");
    }

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const material = this.deriveSolanaMaterialForAccount(
      selectedAccount,
      payload,
    );

    const signedTransaction = signSolanaSwapTransaction({
      transactionBase64: input.transactionBase64,
      fromSecretKey: material.secretKey,
    });

    return { signedTransaction, address: material.address };
  }

  // Sign + broadcast a cross-chain (LI.FI) Solana-source transaction. Unlike the
  // Jupiter same-chain path, this does NOT require the wallet's active network to
  // be Solana (a cross-chain swap's source chain is chosen independently), and it
  // broadcasts the signed bytes directly to a Solana RPC (the bridge proxy has no
  // Solana execute endpoint). It reuses the SAME generic local signer and Solana
  // key derivation — no vault/seed changes, and the Jupiter flow is untouched.
  // Callers MUST only invoke this for a route the gateway marked executable with
  // a "solana" transaction format.
  async executeSelectedSolanaBridgeTransaction(input: {
    transactionBase64: string;
    password?: string;
  }): Promise<{ signature: string; address: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot sign transactions.");
    }

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const material = this.deriveSolanaMaterialForAccount(
      selectedAccount,
      payload,
    );

    // Full deserialize → diagnose → validate blockhash → sign → simulate →
    // broadcast pipeline. Throws a coded SolanaError (BLOCKHASH_EXPIRED,
    // WRONG_SIGNER, PROGRAM_ERROR, ALT_LOOKUP_FAILED, …) the UI maps to a precise
    // message — never a flattened "broadcast failed".
    const { signature } = await executeSolanaBridgeTransaction({
      transactionBase64: input.transactionBase64,
      secretKey: material.secretKey,
      config: SOLANA_MAINNET,
    });

    return { signature, address: material.address };
  }

  // Prepare the active wallet's wrapped-SOL (wSOL) associated token account
  // before a native-SOL Mayan/LI.FI bridge that expects an existing funded wSOL
  // account. Reuses the SAME Solana key derivation as the bridge signer; builds a
  // standard idempotent-ATA + transfer + SyncNative tx (never touches the
  // provider transaction). Callers MUST first confirm setup is needed via
  // detectWsolSetupNeed and that the balance covers amount + rent + fees.
  async executeSelectedSolanaWsolSetup(input: {
    lamportsToWrap: string;
    password?: string;
  }): Promise<{ signature: string; address: string; wsolAta: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot sign transactions.");
    }

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const material = this.deriveSolanaMaterialForAccount(
      selectedAccount,
      payload,
    );

    const { signature, wsolAta } = await executeWsolSetupTransaction({
      secretKey: material.secretKey,
      lamportsToWrap: input.lamportsToWrap,
      config: SOLANA_MAINNET,
    });

    return { signature, address: material.address, wsolAta };
  }

  // Sign + broadcast a cross-chain (LI.FI) TRON-source transaction. The provider
  // returns the TRON tx body as raw_data_hex; the TRON adapter signs the txID
  // locally and broadcasts via /wallet/broadcasthex — NEVER through the EVM
  // signer. Like the Solana bridge path, the active network need not be TRON.
  // Callers MUST only invoke this for a route the gateway marked executable with
  // a "tron" transaction format. The private key is derived here and never leaves
  // the wallet service. A short native-TRX pre-check surfaces the fee shortfall
  // with a precise message before broadcasting.
  async executeSelectedTronBridgeTransaction(input: {
    rawDataHex: string;
    quoteFromAddress?: string | null;
    password?: string;
  }): Promise<{ txId: string; address: string; explorerUrl: string | null }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot sign transactions.");
    }

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const { address, privateKey } = this.deriveTronMaterialForAccount(
      selectedAccount,
      payload,
    );

    // TRON contract calls (bridge / TRC-20) are paid in TRX for energy/bandwidth.
    // Block early with a clear, coded message when the account has no TRX at all,
    // rather than letting the bridge tx land and fail on-chain for fees.
    const trxBalance = await getTrxBalance(address);
    if (trxBalance <= 0n) {
      throw tronError(
        "INSUFFICIENT_TRX_BALANCE",
        "Not enough TRX for network fees.",
      );
    }

    const { txId } = await executeTronBridgeTransaction({
      rawDataHex: input.rawDataHex,
      privateKey,
      expectedFromAddress: address,
      quoteFromAddress: input.quoteFromAddress ?? null,
    });

    return {
      txId,
      address,
      explorerUrl: getTronTransactionExplorerUrl(txId),
    };
  }

  // Build → sign → broadcast a TRC-20 approve for a TRON-source bridge whose
  // provider requires the bridge contract to be approved to spend the source
  // token first. Best-effort waits for the approve tx to confirm so a subsequent
  // bridge quote refresh sees the allowance. Reuses the SAME TRON key derivation.
  async executeSelectedTronBridgeApproval(input: {
    contractAddress: string;
    spender: string;
    amountBaseUnits: string;
    password?: string;
  }): Promise<{ txId: string; address: string }> {
    const walletState = await this.storage.getWalletState();
    const selectedAccount = this.getRequiredSelectedAccount(walletState);

    if (selectedAccount.type === "watch") {
      throw new Error("Watch-only wallet cannot sign transactions.");
    }

    const payload = await this.getDecryptedPayloadForSensitiveOperation(
      input.password,
    );
    const { address, privateKey } = this.deriveTronMaterialForAccount(
      selectedAccount,
      payload,
    );

    // Preflight: a TRC-20 approve burns energy. If the account has no staked
    // energy to cover it, it must hold enough TRX to BURN for that energy — a
    // bare "TRX > 0" check let an underfunded approve land and fail on-chain with
    // "Not enough energy for LOG3". Allow the approve when EITHER the account has
    // ≥ the estimated energy staked, OR holds ≥ the conservative TRX minimum.
    const trxBalanceSun = await getTrxBalance(address);
    const energyAvailable = await getTronAvailableEnergy(address);
    const hasEnoughEnergy = energyAvailable >= TRC20_APPROVE_ENERGY_ESTIMATE;
    if (!hasEnoughEnergy && trxBalanceSun < TRC20_APPROVE_MIN_TRX_SUN) {
      throw tronError(
        "INSUFFICIENT_TRX_BALANCE",
        "Not enough TRX for network fees.",
      );
    }

    const { txId } = await executeTronBridgeApproval({
      contractAddress: input.contractAddress,
      spender: input.spender,
      amountBaseUnits: BigInt(input.amountBaseUnits),
      privateKey,
      fromAddress: address,
    });

    // Return as soon as the approve tx is BROADCAST. Confirmation is polled by the
    // caller (BridgePage) with a bounded, timeout-protected loop so a slow/stuck
    // TronGrid getTransactionInfo can never freeze the UI on "Approving…". We no
    // longer block here on a 60s wait that could hang if the RPC never settles.
    return { txId, address };
  }

  private async persistSolanaAddress(
    walletState: WalletState,
    accountId: WalletAccountId,
    solanaAddress: string,
  ): Promise<void> {
    const accounts = walletState.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      if (account.type === "mnemonic" || account.type === "importedMnemonic") {
        return { ...account, solanaAddress };
      }

      return account;
    });

    await this.storage.saveWalletState({ ...walletState, accounts });
  }

  private async waitForSolanaTransaction(
    config: SolanaChainConfig,
    signature: string,
    timeoutMs: number,
  ): Promise<"confirmed" | "failed"> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await getSolanaActivityStatus(config, signature);

      if (status === "confirmed") return "confirmed";
      if (status === "failed") return "failed";

      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    throw new Error("Transaction confirmation timed out.");
  }

  // Live Solana activity for the selected account, mapped onto the wallet's
  // shared history-item shape so the Activity screen renders it like EVM/TRON/BTC
  // entries. Returns [] for non-Solana chains or when the Solana address can't
  // be resolved (e.g. locked + not yet persisted) — the caller still shows any
  // locally recorded sends.
  async getSelectedSolanaActivity(): Promise<TransactionHistoryItem[]> {
    const walletState = await this.storage.getWalletState();

    if (!isSolanaChainId(walletState.selectedChainId)) {
      return [];
    }

    const account = this.getRequiredSelectedAccount(walletState);
    const config = getRequiredSolanaConfigByChainId(
      walletState.selectedChainId,
    );

    let address: string;
    try {
      address = await this.ensureSolanaAddressForAccount(walletState, account);
    } catch {
      return [];
    }

    const activity = await getSolanaActivity(config, address);

    return activity.map((item) => {
      const createdAt = item.blockTime
        ? new Date(item.blockTime * 1000).toISOString()
        : new Date().toISOString();

      return {
        id: `${config.chainId}:${item.signature.toLowerCase()}`,
        hash: item.signature,
        chainId: config.chainId,
        chainName: config.name,
        direction: item.direction === "incoming" ? "receive" : "send",
        status: item.confirmed ? "confirmed" : "submitted",
        assetType: "native",
        assetSymbol: config.symbol,
        assetName: config.name,
        contractAddress: null,
        amount: lamportsToSol(item.amountLamports),
        // Both endpoints are the wallet's own address for filtering purposes;
        // the row renders by direction + amount, not address.
        fromAddress: address,
        toAddress: address,
        explorerUrl: item.explorerUrl,
        createdAt,
        updatedAt: createdAt,
      };
    });
  }

  // Resolve a Solana address for display: the persisted value if present, else
  // derive from the vault when unlocked. Watch-only / private-key → none.
  // Display-only: derived key material is discarded here and never persisted.
  private resolveSolanaDisplayAddress(
    account: WalletAccount,
    payload: VaultPayload | null,
  ): string | null {
    if (account.type === "watch" || account.type === "privateKey") {
      return null;
    }

    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.solanaAddress
    ) {
      return account.solanaAddress;
    }

    if (!payload) {
      return null;
    }

    try {
      return this.deriveSolanaMaterialForAccount(account, payload).address;
    } catch {
      return null;
    }
  }

  // Receive address for the selected account on the selected network: the EVM
  // address for EVM chains, the (lazily derived) TRON address for TRON.
  async getSelectedReceiveAddress(): Promise<string> {
    const walletState = await this.storage.getWalletState();
    const account = this.getRequiredSelectedAccount(walletState);

    if (isTronChainId(walletState.selectedChainId)) {
      return this.ensureTronAddressForAccount(walletState, account);
    }

    if (isBitcoinChainId(walletState.selectedChainId)) {
      const config = getRequiredBitcoinConfigByChainId(
        walletState.selectedChainId,
      );
      const addresses = await this.ensureBitcoinAddressesForAccount(
        walletState,
        account,
        config,
      );
      // Receive screen shows only the external receive address.
      return addresses.receive;
    }

    if (isSolanaChainId(walletState.selectedChainId)) {
      return this.ensureSolanaAddressForAccount(walletState, account);
    }

    if (isTonChainId(walletState.selectedChainId)) {
      return this.ensureTonAddressForAccount(walletState, account);
    }

    return account.address;
  }

  // The selected account's TRON address in both forms a TRON dApp expects:
  // base58 (T...) and hex (41...). Used by the injected TronLink-compatible
  // provider to answer tron_requestAccounts and to populate
  // tronWeb.defaultAddress. Returns ONLY public addresses — never key material.
  // Resolves without a password when the wallet is unlocked (in-memory vault);
  // throws otherwise so the caller surfaces a "locked" state to the dApp.
  async getSelectedTronAccountInfo(
    password?: string,
  ): Promise<{ base58: string; hex: string }> {
    const walletState = await this.storage.getWalletState();
    const account = this.getRequiredSelectedAccount(walletState);
    const base58 = await this.ensureTronAddressForAccount(
      walletState,
      account,
      password,
    );

    return { base58, hex: tronAddressToHex(base58) };
  }

  // Sign a dApp-supplied unsigned TRON transaction with the selected account's
  // key and return the SIGNED transaction. It is intentionally NOT broadcast —
  // the dApp decides whether to broadcast (sign-only) or sign+send. The private
  // key is derived inside the signing layer and never returned or logged.
  async signTronDappTransaction(input: {
    transaction: unknown;
    password?: string;
  }): Promise<SignedTronTransaction> {
    const account = this.getRequiredTronSigner(
      await this.storage.getWalletState(),
    );

    const transaction = extractTronWcTransaction(input.transaction);
    const privateKey = await this.getTronPrivateKeyForAccount(
      account,
      input.password,
    );

    return signTronTransaction(
      transaction as unknown as UnsignedTronTransaction,
      privateKey,
    );
  }

  // Sign a dApp-supplied message (tron_signMessage) with the selected account's
  // TRON key. Local ECDSA only — never broadcast. Returns the hex signature.
  // The private key is derived inside the signing layer and never returned,
  // logged, or persisted.
  async signTronDappMessage(input: {
    message: unknown;
    password?: string;
  }): Promise<{ signature: string }> {
    const account = this.getRequiredTronSigner(
      await this.storage.getWalletState(),
    );

    const message = extractTronWcMessage(input.message);
    const privateKey = await this.getTronPrivateKeyForAccount(
      account,
      input.password,
    );

    return { signature: signTronMessage(message, privateKey) };
  }

  // Sign AND broadcast a dApp-supplied unsigned TRON transaction
  // (tron_sendTransaction). Returns the broadcast txID. Signing + broadcasting
  // happen in the signing layer; the private key never leaves it.
  async sendTronDappTransaction(input: {
    transaction: unknown;
    password?: string;
  }): Promise<{ txId: string }> {
    const account = this.getRequiredTronSigner(
      await this.storage.getWalletState(),
    );

    const transaction = extractTronWcTransaction(input.transaction);
    const privateKey = await this.getTronPrivateKeyForAccount(
      account,
      input.password,
    );

    const signed = await signTronTransaction(
      transaction as unknown as UnsignedTronTransaction,
      privateKey,
    );

    return sendSignedTronTransaction(signed);
  }

  // Resolve the selected account, rejecting watch-only accounts with a coded
  // error. Shared by the TRON dApp signing methods.
  private getRequiredTronSigner(walletState: WalletState): WalletAccount {
    const account = this.getRequiredSelectedAccount(walletState);

    if (account.type === "watch") {
      throw tronError(
        "TRON_SIGN_FAILED",
        "Watch-only wallet cannot sign transactions.",
      );
    }

    return account;
  }

  // Public multi-chain addresses for every account, for the Accounts screen —
  // independent of the selected network. Derives & persists a missing TRON
  // address for mnemonic-derivable accounts when the wallet is unlocked, and
  // derives (without persisting) for private-key imports. Watch-only accounts
  // get the EVM row only. Returns ONLY public addresses — never key material.
  async getAccountsDisplayAddresses(): Promise<
    Record<WalletAccountId, AccountDisplayAddress[]>
  > {
    const walletState = await this.storage.getWalletState();
    const payload = this.unlockedVault?.payload ?? null;

    const result: Record<WalletAccountId, AccountDisplayAddress[]> = {};
    let nextAccounts = walletState.accounts;
    let mutated = false;

    for (const account of walletState.accounts) {
      const rows: AccountDisplayAddress[] = [
        {
          family: "evm",
          label: "EVM",
          address: account.address,
          explorerUrl: `https://etherscan.io/address/${account.address}`,
        },
      ];

      const tronAddress = this.resolveTronDisplayAddress(account, payload);

      if (tronAddress) {
        // Persist newly derived addresses for mnemonic-derivable accounts so the
        // stored account carries it (consistent with the TRON MVP).
        if (
          (account.type === "mnemonic" ||
            account.type === "importedMnemonic") &&
          account.tronAddress !== tronAddress
        ) {
          nextAccounts = nextAccounts.map((item) =>
            item.id === account.id &&
            (item.type === "mnemonic" || item.type === "importedMnemonic")
              ? { ...item, tronAddress }
              : item,
          );
          mutated = true;
        }

        rows.push({
          family: "tron",
          label: "TRON",
          address: tronAddress,
          explorerUrl: getTronAddressExplorerUrl(tronAddress),
        });
      }

      // Bitcoin: show the receive address for both networks (BTC + tBTC). These
      // are public, deterministic BIP-84 addresses resolved from persisted state
      // or derived for display only — no key material is exposed or persisted
      // here. A failed/locked derivation simply omits the row.
      for (const config of [BITCOIN_MAINNET, BITCOIN_TESTNET]) {
        const bitcoinAddress = this.resolveBitcoinDisplayAddress(
          account,
          payload,
          config,
        );

        if (bitcoinAddress) {
          rows.push({
            family: "bitcoin",
            label: config.isTestnet ? "tBTC" : "BTC",
            address: bitcoinAddress,
            explorerUrl: getBitcoinAddressExplorerUrl(config, bitcoinAddress),
          });
        }
      }

      // Solana: a single base58 address (same on every cluster). Resolved from
      // persisted state or derived for display only — no key material exposed.
      const solanaAddress = this.resolveSolanaDisplayAddress(account, payload);

      if (solanaAddress) {
        if (
          (account.type === "mnemonic" ||
            account.type === "importedMnemonic") &&
          account.solanaAddress !== solanaAddress
        ) {
          nextAccounts = nextAccounts.map((item) =>
            item.id === account.id &&
            (item.type === "mnemonic" || item.type === "importedMnemonic")
              ? { ...item, solanaAddress }
              : item,
          );
          mutated = true;
        }

        rows.push({
          family: "solana",
          label: "Solana",
          address: solanaAddress,
          explorerUrl: getSolanaAddressExplorerUrl(SOLANA_MAINNET, solanaAddress),
        });
      }

      // TON: a single user-friendly address. Resolved from persisted state or
      // derived for display only — no key material exposed.
      const tonAddress = this.resolveTonDisplayAddress(account, payload);

      if (tonAddress) {
        if (
          (account.type === "mnemonic" ||
            account.type === "importedMnemonic") &&
          account.tonAddress !== tonAddress
        ) {
          nextAccounts = nextAccounts.map((item) =>
            item.id === account.id &&
            (item.type === "mnemonic" || item.type === "importedMnemonic")
              ? { ...item, tonAddress }
              : item,
          );
          mutated = true;
        }

        rows.push({
          family: "ton",
          label: "TON",
          address: tonAddress,
          explorerUrl: getTonAddressExplorerUrl(TON_MAINNET, tonAddress),
        });
      }

      result[account.id] = rows;
    }

    if (mutated) {
      await this.storage.saveWalletState({
        ...walletState,
        accounts: nextAccounts,
      });
    }

    return result;
  }

  // Resolve a TRON address for display: the persisted value if present, else
  // derive from the vault when unlocked. Watch-only → none. Never leaks keys.
  private resolveTronDisplayAddress(
    account: WalletAccount,
    payload: VaultPayload | null,
  ): string | null {
    if (account.type === "watch") {
      return null;
    }

    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.tronAddress
    ) {
      return account.tronAddress;
    }

    if (!payload) {
      return null;
    }

    try {
      return this.deriveTronMaterialForAccount(account, payload).address;
    } catch {
      return null;
    }
  }

  // Resolve a Bitcoin receive address for display on the given network: the
  // persisted value if present, else derive from the vault when unlocked.
  // Watch-only → none. Display-only: derived key material is discarded here and
  // never logged or persisted.
  private resolveBitcoinDisplayAddress(
    account: WalletAccount,
    payload: VaultPayload | null,
    config: BitcoinChainConfig,
  ): string | null {
    if (account.type === "watch") {
      return null;
    }

    if (
      (account.type === "mnemonic" || account.type === "importedMnemonic") &&
      account.bitcoinAddresses?.[config.chainId]
    ) {
      return account.bitcoinAddresses[config.chainId].receive;
    }

    if (!payload) {
      return null;
    }

    try {
      return this.deriveBitcoinMaterialForAccount(account, config, payload)
        .receive.address;
    } catch {
      return null;
    }
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