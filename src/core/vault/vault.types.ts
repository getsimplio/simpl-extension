// src/core/vault/vault.types.ts

export type VaultVersion = 1;

export type VaultKdfName = "PBKDF2";
export type VaultCipherName = "AES-GCM";

export type VaultPayload = {
  mnemonic: string;
  createdAt: string;
};

export type EncryptedVault = {
  version: VaultVersion;
  kdf: {
    name: VaultKdfName;
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: VaultCipherName;
    iv: string;
    ciphertext: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateVaultInput = {
  mnemonic: string;
  password: string;
};

export type UnlockVaultInput = {
  encryptedVault: EncryptedVault;
  password: string;
};

export type ChangeVaultPasswordInput = {
  encryptedVault: EncryptedVault;
  oldPassword: string;
  newPassword: string;
};