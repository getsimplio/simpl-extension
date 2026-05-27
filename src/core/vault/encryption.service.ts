// src/core/vault/encryption.service.ts

import type { EncryptedVault, VaultPayload } from "./vault.types";

const VAULT_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 310_000;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

type CryptoBytes = Uint8Array<ArrayBuffer>;

export class EncryptionService {
  async encryptVaultPayload(
    payload: VaultPayload,
    password: string
  ): Promise<EncryptedVault> {
    this.assertPassword(password);

    const salt = this.getRandomBytes(SALT_LENGTH_BYTES);
    const iv = this.getRandomBytes(IV_LENGTH_BYTES);

    const key = await this.deriveAesKey(password, salt);
    const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));

    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      encodedPayload
    );

    const now = new Date().toISOString();

    return {
      version: VAULT_VERSION,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        salt: this.bytesToBase64(salt),
      },
      cipher: {
        name: "AES-GCM",
        iv: this.bytesToBase64(iv),
        ciphertext: this.bytesToBase64(new Uint8Array(encryptedBuffer)),
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  async decryptVaultPayload(
    encryptedVault: EncryptedVault,
    password: string
  ): Promise<VaultPayload> {
    this.assertPassword(password);

    const salt = this.base64ToBytes(encryptedVault.kdf.salt);
    const iv = this.base64ToBytes(encryptedVault.cipher.iv);
    const ciphertext = this.base64ToBytes(encryptedVault.cipher.ciphertext);

    const key = await this.deriveAesKey(password, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      ciphertext
    );

    const json = new TextDecoder().decode(decryptedBuffer);
    const payload = JSON.parse(json) as VaultPayload;

    this.assertValidVaultPayload(payload);

    return payload;
  }

  private async deriveAesKey(
    password: string,
    salt: CryptoBytes
  ): Promise<CryptoKey> {
    const passwordBytes = new TextEncoder().encode(password);

    const baseKey = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      baseKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private getRandomBytes(length: number): CryptoBytes {
    const bytes = new Uint8Array(new ArrayBuffer(length)) as CryptoBytes;
    crypto.getRandomValues(bytes);

    return bytes;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  private base64ToBytes(base64: string): CryptoBytes {
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length)) as CryptoBytes;

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  private assertPassword(password: string): void {
    if (!password) {
      throw new Error("Password is required.");
    }

    if (password.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }
  }

  private assertValidVaultPayload(payload: VaultPayload): void {
    if (!payload.mnemonic) {
      throw new Error("Invalid vault payload: mnemonic is missing.");
    }

    if (!payload.createdAt) {
      throw new Error("Invalid vault payload: createdAt is missing.");
    }
  }
}

export const encryptionService = new EncryptionService();