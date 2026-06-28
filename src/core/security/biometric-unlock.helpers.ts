import type { WalletState } from "../storage/storage.types";

// A stable per-wallet identifier used as the WebAuthn user handle when enrolling.
// Prefers an already-stored credential id so re-enrollment stays consistent.
export function getBiometricWalletId(walletState: WalletState): string {
  if (walletState.settings.biometricUnlock.credentialId) {
    return walletState.settings.biometricUnlock.credentialId;
  }

  const rootAccount = walletState.accounts.find(
    (account) => account.index === 0,
  );

  return rootAccount?.id ?? walletState.selectedAccountId ?? "default-wallet";
}

export type BiometricPlatform = "apple" | "windows" | "generic";

// Best-effort platform detection so the UI can show the right brand name
// (Touch ID / Windows Hello / Device biometrics). Falls back to "generic".
export function detectBiometricPlatform(): BiometricPlatform {
  try {
    const uaData = (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData;
    const platform = (
      uaData?.platform ??
      navigator.platform ??
      navigator.userAgent ??
      ""
    ).toLowerCase();

    if (
      platform.includes("mac") ||
      platform.includes("iphone") ||
      platform.includes("ipad") ||
      platform.includes("ios")
    ) {
      return "apple";
    }
    if (platform.includes("win")) {
      return "windows";
    }
  } catch {
    // Ignore detection failures and fall through to the generic label.
  }

  return "generic";
}
