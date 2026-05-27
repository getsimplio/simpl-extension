// src/popup/routes/UnlockPage.tsx

import { useState } from "react";
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

function normalizeTouchIdError(error: unknown): UnlockNotice {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("cancel") ||
    lowerMessage.includes("canceled") ||
    lowerMessage.includes("cancelled")
  ) {
    return {
      type: "info",
      message: "Touch ID was canceled. Try again or use password.",
    };
  }

  if (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("missing") ||
    lowerMessage.includes("not enabled")
  ) {
    return {
      type: "info",
      message: "Touch ID unlock is not enabled. Use password instead.",
    };
  }

  return {
    type: "error",
    message: "Touch ID is unavailable. Use your wallet password.",
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

function getNoticeStyle(type: UnlockNotice["type"]) {
  if (type === "error") {
    return {
      background: "var(--danger-soft)",
      color: "var(--danger)",
    };
  }

  if (type === "success") {
    return {
      background: "var(--secure-soft)",
      color: "var(--secure)",
    };
  }

  return {
    background: "var(--warn-soft)",
    color: "var(--warn)",
  };
}

export function UnlockPage({
  walletState,
  onUnlocked,
  onRestoreFromSeed,
}: UnlockPageProps) {
  const [password, setPassword] = useState("");
  const [showPasswordMode, setShowPasswordMode] = useState(false);
  const [notice, setNotice] = useState<UnlockNotice | null>(null);
  const [isTouchIdLoading, setIsTouchIdLoading] = useState(false);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

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

      const walletId =
        biometricSettings.credentialId ?? getBiometricWalletId(walletState);

      const response = await nativeMessagingClient.getVaultKey(walletId);

      if (!response.ok) {
        throw new Error(response.error);
      }

      const passwordFromKeychain = decodeSecretFromBase64(
        response.data.vaultKeyBase64,
      );

      await walletService.unlockWallet({
        password: passwordFromKeychain,
      });

      await onUnlocked?.();
    } catch (error) {
      setNotice(normalizeTouchIdError(error));
      setShowPasswordMode(true);
    } finally {
      setIsTouchIdLoading(false);
    }
  }

  async function handlePasswordUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmitPassword) return;

    try {
      setNotice(null);
      setIsPasswordLoading(true);

      await walletService.unlockWallet({
        password,
      });

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
      <div
        className="screen-body"
        style={{
          padding: "60px 24px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <LogoMark />

        <div className="t-h2" style={{ marginTop: 12 }}>
          Welcome back
        </div>

        <div
          style={{
            color: "var(--ink-3)",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 1.45,
            maxWidth: 260,
          }}
        >
          Unlock your self-custody wallet to access accounts and sign
          transactions.
        </div>

        {notice ? (
          <div
            style={{
              ...getNoticeStyle(notice.type),
              width: "100%",
              marginTop: 18,
              padding: "10px 12px",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {notice.message}
          </div>
        ) : null}

        {showPasswordMode ? (
          <form
            onSubmit={handlePasswordUnlock}
            style={{
              width: "100%",
              marginTop: 24,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div>
              <span className="field-label">Password</span>

              <input
                className="input lg"
                type="password"
                placeholder="Enter password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
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
        ) : (
          <button
            className="btn primary lg full"
            type="button"
            onClick={() => void handleTouchIdUnlock()}
            disabled={isTouchIdLoading || isPasswordLoading}
            style={{ marginTop: 32 }}
          >
            <TouchIdIcon />
            {isTouchIdLoading ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
          </button>
        )}

        <button
          className="btn secondary lg full"
          type="button"
          onClick={() => {
            setShowPasswordMode((value) => !value);
            setNotice(null);
          }}
          disabled={isTouchIdLoading || isPasswordLoading}
          style={{ marginTop: 0 }}
        >
          {showPasswordMode ? "Hide password unlock" : "Use password instead"}
        </button>

        <div style={{ flex: 1 }} />

        <div
          style={{
            width: "100%",
            padding: "12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg-surface)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-1)",
              marginBottom: 4,
            }}
          >
            Seed phrase stays on your device.
          </div>

          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.45,
            }}
          >
            SIMPLE never stores or accesses it.
          </div>
        </div>

        <button
          className="btn ghost full"
          type="button"
          onClick={onRestoreFromSeed}
          style={{
            height: 34,
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          Forgot password · restore from phrase
        </button>
      </div>
    </div>
  );
}

export default UnlockPage;
