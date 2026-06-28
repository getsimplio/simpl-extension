// src/popup/components/BiometricUnlockRow.tsx
//
// Biometric (Touch ID / Windows Hello / device biometrics) unlock control,
// rendered inside Security Center. Self-contained: it owns capability detection
// and the secure WebAuthn-PRF enroll/disable flow, and renders NOTHING when the
// platform can't run a secure biometric flow — so unsupported devices never see
// it. The enroll path verifies the wallet password first and stores only the
// PRF-wrapped (encrypted) secret; no raw password / seed / key is persisted.

import { useEffect, useState } from "react";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import { storageRepository } from "../../core/storage/storage.repository";
import {
  biometricUnlockService,
  BiometricError,
} from "../../core/security/biometric-unlock.service";
import {
  detectBiometricPlatform,
  getBiometricWalletId,
} from "../../core/security/biometric-unlock.helpers";
import { useTranslation } from "../../i18n";

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 11a6.5 6.5 0 0 1 13 0M8 11a4 4 0 0 1 8 0v1.5M12 11v3.5M9.2 13.5c0 2.5.6 4 1.3 5.4M14.8 13v2c0 1.6.3 2.8.8 4M6.5 14.5c0 2 .4 3.5 1 4.7"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

// Toggle switch (role=switch) — keyboard-accessible, mirrors the Security Center
// Hide-balances toggle styling.
function Toggle({
  checked,
  disabled,
  onClick,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`set-toggle${checked ? " set-toggle--on" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="set-toggle__knob" />
    </button>
  );
}

type BiometricUnlockRowProps = {
  walletState: WalletState;
  onChanged: () => void | Promise<void>;
};

export function BiometricUnlockRow({
  walletState,
  onChanged,
}: BiometricUnlockRowProps) {
  const { t } = useTranslation();

  // null while we probe the platform authenticator; the row stays hidden until
  // it resolves to true so the feature never shows on unsupported devices.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const enabled = walletState.settings.biometricUnlock.enabled;
  const label = (() => {
    switch (detectBiometricPlatform()) {
      case "apple":
        return t("settings.touchId");
      case "windows":
        return t("settings.biometric.windowsHello");
      default:
        return t("settings.biometric.generic");
    }
  })();

  useEffect(() => {
    let active = true;
    void biometricUnlockService
      .isAvailable()
      .then((available) => {
        if (active) setSupported(available);
      })
      .catch(() => {
        if (active) setSupported(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function enrollErrorMessage(error: unknown): string {
    if (error instanceof BiometricError) {
      switch (error.code) {
        case "cancelled":
          return t("settings.biometric.cancelled");
        case "unavailable":
        case "unsupported":
          return t("settings.biometric.unavailable");
        default:
          return t("settings.biometric.enableFailed");
      }
    }
    return t("settings.biometric.enableFailed");
  }

  // Enabled → disable directly; disabled → reveal the inline password form.
  function onToggle() {
    if (busy) return;
    if (enabled) {
      void disable();
    } else {
      setStatus(null);
      setFormOpen((open) => !open);
    }
  }

  // Verify the wallet password first, then create a real biometric credential
  // and store ONLY the PRF-wrapped (encrypted) secret. Persist `enabled: true`
  // only after enrollment fully succeeds.
  async function enable() {
    setStatus(null);

    if (!password) {
      setStatus(t("settings.touchId.enterPassword"));
      return;
    }

    setBusy(true);
    setStatus(t("settings.touchId.checking"));

    try {
      await walletService.unlockWallet({ password });
    } catch {
      setStatus(t("settings.touchId.wrongPassword"));
      setBusy(false);
      return;
    }

    try {
      const walletId = getBiometricWalletId(walletState);
      const enrollment = await biometricUnlockService.enroll({
        userId: walletId,
        username: "SIMPL Wallet",
        displayName: "SIMPL Wallet",
        secret: password,
      });

      await storageRepository.updateSettings({
        biometricUnlock: {
          enabled: true,
          credentialId: enrollment.credentialId,
          createdAt: enrollment.createdAt,
          prfSalt: enrollment.prfSalt,
          iv: enrollment.iv,
          wrappedSecret: enrollment.wrappedSecret,
        },
      });

      setPassword("");
      setFormOpen(false);
      setStatus(t("settings.touchId.enabled"));
      await onChanged();
    } catch (error) {
      setStatus(enrollErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // Clear the credential + all wrapping material. Nothing else to revoke.
  async function disable() {
    setBusy(true);
    setStatus(t("settings.touchId.disabling"));

    await storageRepository.updateSettings({
      biometricUnlock: {
        enabled: false,
        credentialId: null,
        createdAt: null,
        prfSalt: null,
        iv: null,
        wrappedSecret: null,
      },
    });

    setStatus(t("settings.touchId.disabled"));
    setBusy(false);
    await onChanged();
  }

  if (!supported) return null;

  return (
    <>
      <div className="set-row set-row--static">
        <span className="set-row__icon set-row__icon--secure">
          <FingerprintIcon />
        </span>
        <span className="set-row__body">
          <span className="set-row__title">{label}</span>
          <span className="set-row__sub">{t("settings.touchIdSub")}</span>
        </span>
        <span className="set-row__aside">
          <Toggle
            checked={enabled}
            disabled={busy}
            onClick={onToggle}
            label={t("settings.touchIdToggleLabel")}
          />
        </span>
      </div>

      {!enabled && formOpen ? (
        <div className="set-touchid-form">
          <input
            className="input lg"
            type="password"
            value={password}
            placeholder={t("settings.touchIdPasswordPlaceholder")}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />

          <div className="set-touchid-form__actions">
            <button
              type="button"
              className="btn secondary lg"
              onClick={() => {
                setFormOpen(false);
                setPassword("");
                setStatus(null);
              }}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>

            <button
              type="button"
              className="btn primary lg"
              onClick={() => void enable()}
              disabled={busy || !password}
            >
              {busy ? t("common.enabling") : t("common.enable")}
            </button>
          </div>
        </div>
      ) : null}

      {status ? <div className="set-status">{status}</div> : null}
    </>
  );
}

export default BiometricUnlockRow;
