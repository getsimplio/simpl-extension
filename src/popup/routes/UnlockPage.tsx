// src/popup/routes/UnlockPage.tsx

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import { nativeMessagingClient } from "../../core/native/native-messaging.client";
import { getBiometricWalletId } from "../../core/security/biometric-unlock.helpers";

type UnlockNotice = {
  type: "info" | "error" | "success";
  message: string;
};

type UnlockPageProps = {
  walletState: WalletState | null;
  onUnlocked?: () => Promise<void> | void;
  onRestoreFromSeed?: () => void;
};

function decodeSecretFromBase64(secretBase64: string): string {
  const binaryString = window.atob(secretBase64);
  const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

type NormalizedTouchIdError = {
  notice: UnlockNotice;
  isCancellation: boolean;
};

function normalizeTouchIdError(error: unknown): NormalizedTouchIdError {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("cancel") ||
    lowerMessage.includes("canceled") ||
    lowerMessage.includes("cancelled")
  ) {
    return {
      isCancellation: true,
      notice: {
        type: "info",
        message: "Touch ID was cancelled. Tap to try again or use password.",
      },
    };
  }

  if (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("missing") ||
    lowerMessage.includes("not enabled")
  ) {
    return {
      isCancellation: false,
      notice: {
        type: "info",
        message: "Touch ID is not set up for this wallet. Use password instead.",
      },
    };
  }

  return {
    isCancellation: false,
    notice: {
      type: "error",
      message: "Touch ID failed. Use your wallet password to unlock.",
    },
  };
}

function LogoMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      width="40"
      height="40"
      aria-hidden="true"
      style={{ color: "var(--ink-1)" }}
    >
      <path d="M0 6 L50 6 L50 38 L38 50 L0 50 Z" fill="currentColor" />
      <rect x="10" y="26" width="22" height="4" fill="var(--bg-canvas)" />
    </svg>
  );
}

function TouchIdIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.2 12.4c0-2.7 2.1-4.9 4.8-4.9s4.8 2.2 4.8 4.9" />
      <path d="M5.1 10.8C5.7 7.5 8.5 5 12 5s6.3 2.5 6.9 5.8" />
      <path d="M3.8 14.3v-1.9C3.8 7.9 7.5 4.2 12 4.2s8.2 3.7 8.2 8.2v1.9" />
      <path d="M9 13.2v1.2c0 1.7 1.3 3 3 3s3-1.3 3-3v-1.2" />
      <path d="M12 11.1v3.1" />
      <path d="M8.2 18.2c.9 1 2.3 1.6 3.8 1.6s2.9-.6 3.8-1.6" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

export function UnlockPage({
  walletState,
  onUnlocked,
  onRestoreFromSeed,
}: UnlockPageProps) {
  const biometricEnabled =
    walletState?.settings.biometricUnlock.enabled === true;

  const [password, setPassword] = useState("");
  const [showPasswordMode, setShowPasswordMode] = useState(!biometricEnabled);
  const [notice, setNotice] = useState<UnlockNotice | null>(null);
  const [isTouchIdLoading, setIsTouchIdLoading] = useState(false);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // Prevents auto-biometric from firing more than once per page session
  const hasAutoBiometricAttemptedRef = useRef(false);

  const canSubmitPassword = password.trim().length > 0 && !isPasswordLoading;

  async function handleTouchIdUnlock() {
    try {
      setNotice(null);
      setIsTouchIdLoading(true);

      if (!walletState) {
        throw new Error("Wallet state is missing.");
      }

      const biometricSettings = walletState.settings.biometricUnlock;

      if (!biometricSettings.enabled) {
        setNotice({
          type: "info",
          message: "Touch ID unlock is not enabled. Use password instead.",
        });
        setShowPasswordMode(true);
        return;
      }

      const fallbackWalletId = getBiometricWalletId(walletState);
      const walletIds = Array.from(
        new Set(
          [biometricSettings.credentialId, fallbackWalletId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      );

      let response: Awaited<
        ReturnType<typeof nativeMessagingClient.getVaultKey>
      > | null = null;
      let lastTouchIdError: string | undefined;

      for (const walletId of walletIds) {
        const nextResponse = await nativeMessagingClient.getVaultKey(walletId);
        if (nextResponse.ok) {
          response = nextResponse;
          break;
        }
        lastTouchIdError = nextResponse.error;
      }

      if (!response?.ok) {
        throw new Error(
          lastTouchIdError ?? "Touch ID vault key is unavailable.",
        );
      }

      const passwordFromKeychain = decodeSecretFromBase64(
        response.data.vaultKeyBase64,
      );

      await walletService.unlockWallet({ password: passwordFromKeychain });
      await onUnlocked?.();
    } catch (error) {
      const { notice: errorNotice, isCancellation } =
        normalizeTouchIdError(error);
      setNotice(errorNotice);
      // Cancellation: keep Touch ID button visible so user can retry.
      // Any other error: switch to password mode.
      if (!isCancellation) {
        setShowPasswordMode(true);
      }
    } finally {
      setIsTouchIdLoading(false);
    }
  }

  // Auto-trigger Touch ID once on mount if biometric unlock is enabled.
  // The ref guard ensures this fires at most once per page session,
  // even if the component re-renders or the effect fires again.
  useEffect(() => {
    if (!biometricEnabled) return;
    if (hasAutoBiometricAttemptedRef.current) return;
    hasAutoBiometricAttemptedRef.current = true;
    void handleTouchIdUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePasswordUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPassword) return;

    try {
      setNotice(null);
      setIsPasswordLoading(true);
      await walletService.unlockWallet({ password });
      await onUnlocked?.();
    } catch {
      setNotice({
        type: "error",
        message: "Incorrect password. Please try again.",
      });
    } finally {
      setIsPasswordLoading(false);
    }
  }

  return (
    <div className="ext-popup" data-screen-label="02 Unlock">
      <div className="screen-body unlock-body">
        {/* Logo + title + subtitle */}
        <div className="unlock-hero">
          <LogoMark />
          <div className="t-h2 unlock-title">Welcome back</div>
          <div className="unlock-subtitle">
            Unlock your wallet to manage assets and sign transactions.
          </div>
        </div>

        {/* Inline notice (non-blocking) */}
        {notice ? (
          <div className={`unlock-notice unlock-notice--${notice.type}`}>
            {notice.message}
          </div>
        ) : null}

        {/* Primary actions */}
        <div className="unlock-actions">
          {!showPasswordMode ? (
            <button
              className="btn primary lg full"
              type="button"
              onClick={() => void handleTouchIdUnlock()}
              disabled={isTouchIdLoading || isPasswordLoading}
            >
              <TouchIdIcon />
              {isTouchIdLoading
                ? "Waiting for Touch ID…"
                : "Unlock with Touch ID"}
            </button>
          ) : (
            <form
              onSubmit={(e) => void handlePasswordUnlock(e)}
              className="unlock-password-form"
            >
              <div>
                <span className="field-label">Password</span>
                <input
                  className="input lg"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button
                className="btn primary lg full"
                type="submit"
                disabled={!canSubmitPassword}
              >
                <UnlockIcon />
                {isPasswordLoading ? "Unlocking…" : "Unlock"}
              </button>
            </form>
          )}

          {/* Toggle only shown when biometric is configured */}
          {biometricEnabled ? (
            <button
              className="btn secondary lg full"
              type="button"
              onClick={() => {
                setShowPasswordMode((prev) => !prev);
                setNotice(null);
              }}
              disabled={isTouchIdLoading || isPasswordLoading}
            >
              {showPasswordMode ? "Use Touch ID instead" : "Use password instead"}
            </button>
          ) : null}
        </div>

        {/* Security assurance card */}
        <div className="unlock-security-card">
          <div className="unlock-security-card__title">
            Seed phrase stays on your device.
          </div>
          <div className="unlock-security-card__body">
            SIMPLE never stores or accesses it.
          </div>
        </div>

        {/* Restore link */}
        <button
          className="btn ghost full"
          type="button"
          onClick={onRestoreFromSeed}
          style={{ height: 34, fontSize: 12, color: "var(--ink-3)" }}
        >
          Forgot password · restore from phrase
        </button>
      </div>
    </div>
  );
}

export default UnlockPage;
