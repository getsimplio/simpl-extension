
import { HDNodeWallet } from "ethers";

export type EvmAddress = `0x${string}`;
export type EvmPrivateKey = `0x${string}`;
export type EvmDerivationPath = `m/44'/60'/0'/0/${number}`;

export type DerivedEvmAccount = {
  index: number;
  address: EvmAddress;
  privateKey: EvmPrivateKey;
  publicKey: string;
  derivationPath: EvmDerivationPath;
};

export const EVM_DERIVATION_BASE_PATH = "m/44'/60'/0'/0" as const;

export function assertValidAccountIndex(index: number): void {
  if (!Number.isInteger(index)) {
    throw new Error("Account index must be an integer.");
  }

  if (index < 0) {
    throw new Error("Account index must be greater than or equal to 0.");
  }
}

export function normalizeMnemonicForDerivation(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getEvmDerivationPath(index: number): EvmDerivationPath {
  assertValidAccountIndex(index);

  return `${EVM_DERIVATION_BASE_PATH}/${index}`;
}

export function deriveEvmAccount(
  mnemonic: string,
  index: number
): DerivedEvmAccount {
  const normalizedMnemonic = normalizeMnemonicForDerivation(mnemonic);
  const derivationPath = getEvmDerivationPath(index);

  const wallet = HDNodeWallet.fromPhrase(
    normalizedMnemonic,
    undefined,
    derivationPath
  );

  return {
    index,
    address: wallet.address as EvmAddress,
    privateKey: wallet.privateKey as EvmPrivateKey,
    publicKey: wallet.publicKey,
    derivationPath,
  };
}

export function deriveEvmAddress(
  mnemonic: string,
  index: number
): EvmAddress {
  return deriveEvmAccount(mnemonic, index).address;
}

export function deriveEvmPrivateKey(
  mnemonic: string,
  index: number
): EvmPrivateKey {
  return deriveEvmAccount(mnemonic, index).privateKey;
}

export function deriveManyEvmAccounts(
  mnemonic: string,
  count: number
): DerivedEvmAccount[] {
  if (!Number.isInteger(count)) {
    throw new Error("Accounts count must be an integer.");
  }

  if (count <= 0) {
    throw new Error("Accounts count must be greater than 0.");
  }

  return Array.from({ length: count }, (_, index) => {
    return deriveEvmAccount(mnemonic, index);
  });
}