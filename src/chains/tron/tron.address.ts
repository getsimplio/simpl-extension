// src/chains/tron/tron.address.ts
//
// TRON address + key derivation. TRON uses secp256k1 like EVM, so we reuse
// ethers' BIP-32/BIP-39 HD derivation at the TRON coin type (m/44'/195'/0'/0/i)
// to obtain the private key, then convert to a TRON base58 address.
//
// SECURITY: the private key produced here must never reach the React UI. It is
// derived inside the wallet/background service layer at signing time only.

import { HDNodeWallet } from "ethers";
import { TronWeb } from "tronweb";
import { normalizeMnemonicForDerivation } from "../../core/accounts/derivation";
import { TRON_COIN_TYPE } from "./tron.config";

// A TRON base58 address (starts with "T").
export type TronAddress = string;
// A 64-char hex private key WITHOUT the 0x prefix (the form TronWeb expects).
export type TronPrivateKey = string;

export type DerivedTronAccount = {
  index: number;
  address: TronAddress;
  privateKey: TronPrivateKey;
  derivationPath: string;
};

export function getTronDerivationPath(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Account index must be a non-negative integer.");
  }

  return `m/44'/${TRON_COIN_TYPE}'/0'/0/${index}`;
}

// Strip the 0x prefix ethers returns; TronWeb's static helpers expect raw hex.
function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

export function deriveTronAccount(
  mnemonic: string,
  index: number,
): DerivedTronAccount {
  const normalizedMnemonic = normalizeMnemonicForDerivation(mnemonic);
  const derivationPath = getTronDerivationPath(index);

  const wallet = HDNodeWallet.fromPhrase(
    normalizedMnemonic,
    undefined,
    derivationPath,
  );

  const privateKey = stripHexPrefix(wallet.privateKey);
  const address = TronWeb.address.fromPrivateKey(privateKey);

  if (typeof address !== "string" || !isValidTronAddress(address)) {
    throw new Error("Failed to derive a valid TRON address.");
  }

  return {
    index,
    address,
    privateKey,
    derivationPath,
  };
}

export function deriveTronAddress(mnemonic: string, index: number): TronAddress {
  return deriveTronAccount(mnemonic, index).address;
}

// Derive a TRON address from a raw secp256k1 private key (e.g. an imported EVM
// key). Accepts the key with or without the 0x prefix.
export function tronAddressFromPrivateKey(privateKey: string): TronAddress {
  const normalized = stripHexPrefix(privateKey.trim());

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Invalid private key.");
  }

  const address = TronWeb.address.fromPrivateKey(normalized);

  if (typeof address !== "string") {
    throw new Error("Invalid private key.");
  }

  return address;
}

// Convert a TRON base58 address (T...) to its hex form (41...). TRON dApps /
// TronLink expose both: defaultAddress.base58 and defaultAddress.hex. Throws on
// an invalid base58 address.
export function tronAddressToHex(base58Address: string): string {
  if (!isValidTronAddress(base58Address)) {
    throw new Error("Invalid TRON address.");
  }

  const hex = TronWeb.address.toHex(base58Address);

  if (typeof hex !== "string") {
    throw new Error("Failed to convert TRON address to hex.");
  }

  return hex;
}

// Validate a TRON base58 address. TronWeb checks the version byte and checksum,
// so this rejects EVM 0x addresses and malformed input.
export function isValidTronAddress(address: string): boolean {
  if (typeof address !== "string" || !address.startsWith("T")) {
    return false;
  }

  try {
    return TronWeb.isAddress(address);
  } catch {
    return false;
  }
}
