import type { WalletState } from "../storage/storage.types";

export function getBiometricWalletId(walletState: WalletState): string {
  if (walletState.settings.biometricUnlock.credentialId) {
    return walletState.settings.biometricUnlock.credentialId;
  }

  const rootAccount = walletState.accounts.find((account) => account.index === 0);

  return (
    rootAccount?.id ??
    walletState.selectedAccountId ??
    "default-wallet"
  );
}

export function encodeSecretToBase64(secret: string): string {
  const bytes = new TextEncoder().encode(secret);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function decodeSecretFromBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}
