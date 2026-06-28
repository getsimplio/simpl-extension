import type { EvmAddress, EvmDerivationPath } from "./derivation";

export type WalletAccountId = string;

// Bitcoin is UTXO-based with a receive + change address per network. These are
// public addresses only (BIP-84 native SegWit, m/84'/coin'/{index}'/{0|1}/0),
// derived lazily and persisted for display — the same lazy-migration pattern as
// `tronAddress`. Keyed by the internal Bitcoin chain id (mainnet vs testnet use
// different coin types and address prefixes). Never carries key material.
// TODO(btc): when HD address rotation / gap scanning lands, this becomes a list
// of receive addresses per network instead of a single fixed pair.
export type BitcoinAccountAddresses = {
  receive: string;
  change: string;
};

export type BitcoinAddressMap = Record<number, BitcoinAccountAddresses>;

// Account "source" discriminator:
// - "mnemonic"         → derived from the primary wallet seed at a BIP-44 index
// - "importedMnemonic" → first account of a separately imported recovery phrase
// - "privateKey"       → a single account imported from a raw EVM private key
// - "watch"            → address only, cannot sign
export type WalletAccountType =
  | "mnemonic"
  | "importedMnemonic"
  | "privateKey"
  | "watch";

// Multi-family addresses. `address` (EVM) stays the primary field so all
// existing EVM behavior is untouched; non-EVM addresses are added as optional
// fields and derived lazily (see wallet.service.ensureSelectedTronAddress).
// For mnemonic-derivable accounts, `tronAddress` is a TRON base58 address
// (m/44'/195'/0'/0/index). Absent on stored accounts created before TRON
// support — migrated on first use.
export type MnemonicWalletAccount = {
  id: WalletAccountId;
  type: "mnemonic";
  index: number;
  address: EvmAddress;
  tronAddress?: string;
  bitcoinAddresses?: BitcoinAddressMap;
  // Solana base58 public key (Ed25519, m/44'/501'/index'/0'). Absent on stored
  // accounts created before Solana support — derived lazily and persisted on
  // first use, the same migration pattern as `tronAddress`. Never key material.
  solanaAddress?: string;
  // TON wallet contract address (Ed25519, m/44'/607'/index'/0', user-friendly
  // non-bounceable UQ… form). Absent on stored accounts created before TON
  // support — derived lazily and persisted on first use, the same migration
  // pattern as `solanaAddress`. Public address only — never key material.
  tonAddress?: string;
  label: string;
  derivationPath: EvmDerivationPath;
  createdAt: string;
};

// Imported recovery phrase — its first account. The phrase itself lives only in
// the encrypted vault (never on the account record); signing re-derives by id.
export type ImportedMnemonicWalletAccount = {
  id: WalletAccountId;
  type: "importedMnemonic";
  index: number;
  address: EvmAddress;
  tronAddress?: string;
  bitcoinAddresses?: BitcoinAddressMap;
  solanaAddress?: string;
  tonAddress?: string;
  label: string;
  derivationPath: EvmDerivationPath;
  createdAt: string;
};

// Imported raw private key — one account. The key lives only in the encrypted
// vault (never on the account record); signing looks it up by id.
export type ImportedPrivateKeyWalletAccount = {
  id: WalletAccountId;
  type: "privateKey";
  index: null;
  address: EvmAddress;
  label: string;
  derivationPath: null;
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

export type WalletAccount =
  | MnemonicWalletAccount
  | ImportedMnemonicWalletAccount
  | ImportedPrivateKeyWalletAccount
  | WatchWalletAccount;

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

export function isWatchOnly(account: WalletAccount | null | undefined): boolean {
  return account?.type === "watch";
}

// Any non-watch account can sign (primary, imported mnemonic, or private key).
export function canSign(account: WalletAccount | null | undefined): boolean {
  return account != null && account.type !== "watch";
}

// Whether the account came from an external import (vs the primary wallet seed).
export function isImportedAccount(
  account: WalletAccount | null | undefined,
): boolean {
  return account?.type === "importedMnemonic" || account?.type === "privateKey";
}