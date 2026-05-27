// src/core/vault/vault.service.ts

import { encryptionService } from "./encryption.service";
import type {
  ChangeVaultPasswordInput,
  CreateVaultInput,
  EncryptedVault,
  UnlockVaultInput,
  VaultPayload,
} from "./vault.types";

export class VaultService {
  async createVault(input: CreateVaultInput): Promise<EncryptedVault> {
    const mnemonic = this.normalizeMnemonic(input.mnemonic);

    const payload: VaultPayload = {
      mnemonic,
      createdAt: new Date().toISOString(),
    };

    return encryptionService.encryptVaultPayload(payload, input.password);
  }

  async unlockVault(input: UnlockVaultInput): Promise<VaultPayload> {
    return encryptionService.decryptVaultPayload(
      input.encryptedVault,
      input.password
    );
  }

  async revealMnemonic(input: UnlockVaultInput): Promise<string> {
    const payload = await this.unlockVault(input);

    return payload.mnemonic;
  }

  async verifyPassword(input: UnlockVaultInput): Promise<boolean> {
    try {
      await this.unlockVault(input);
      return true;
    } catch {
      return false;
    }
  }

  async changePassword(
    input: ChangeVaultPasswordInput
  ): Promise<EncryptedVault> {
    const payload = await this.unlockVault({
      encryptedVault: input.encryptedVault,
      password: input.oldPassword,
    });

    return encryptionService.encryptVaultPayload(payload, input.newPassword);
  }

  private normalizeMnemonic(mnemonic: string): string {
    return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  }
}

export const vaultService = new VaultService();