// src/popup/routes/UnlockPage.tsx

import { useEffect, useRef, useState } from "react";
import logoUrl from "../../assets/simpl-logo.png";
import type { FormEvent } from "react";
import type {
  BiometricUnlockSettings,
  WalletState,
} from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import {
  biometricUnlockService,
  BiometricError,
} from "../../core/security/biometric-unlock.service";
import { detectBiometricPlatform } from "../../core/security/biometric-unlock.helpers";
import { biometricDebug } from "../../core/security/biometric-debug";
import { consumeBiometricAutoPromptSuppression } from "../biometric-autoprompt";
import { getCurrentSurface } from "../surface";
import { t, useTranslation } from "../../i18n";

type UnlockNotice = {
  type: "info" | "error" | "success";
  message: string;
};

// Safety net for a WebAuthn prompt that never resolves/rejects (notably a
// fullscreen tab or side panel that lacks a fresh user activation, so the OS
// dialog never surfaces). Bounded so the UI always leaves the "Waiting…" state
// and the password path stays usable.
const BIOMETRIC_TIMEOUT_MS = 12_000;

type UnlockPageProps = {
  walletState: WalletState | null;
  onUnlocked?: () => Promise<void> | void;
  onRestoreFromSeed?: () => void;
};

// A biometric config is only usable when it is enabled AND carries the full set
// of PRF wrapping material. Old/partial flags (e.g. a legacy `enabled: true`
// with no credential) are treated as not-configured, so they never offer a
// broken biometric prompt — the wallet just stays on password unlock.
function readBiometricConfig(settings: BiometricUnlockSettings): {
  credentialId: string;
  prfSalt: string;
  iv: string;
  wrappedSecret: string;
} | null {
  if (!settings.enabled) return null;
  const { credentialId, prfSalt, iv, wrappedSecret } = settings;
  if (!credentialId || !prfSalt || !iv || !wrappedSecret) return null;
  return { credentialId, prfSalt, iv, wrappedSecret };
}

function biometricLabel(): string {
  switch (detectBiometricPlatform()) {
    case "apple":
      return t("settings.touchId");
    case "windows":
      return t("settings.biometric.windowsHello");
    default:
      return t("settings.biometric.generic");
  }
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

function BiometricIcon() {
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

export function UnlockPage({
  walletState,
  onUnlocked,
  onRestoreFromSeed,
}: UnlockPageProps) {
  const { t } = useTranslation();
  const label = biometricLabel();

  const biometricConfig = walletState
    ? readBiometricConfig(walletState.settings.biometricUnlock)
    : null;

  const [password, setPassword] = useState("");
  // `biometricUsable` is null while we confirm the platform authenticator is
  // present right now. Until it resolves true, the biometric button is hidden;
  // the password form is always shown regardless.
  const [biometricUsable, setBiometricUsable] = useState<boolean | null>(
    biometricConfig ? null : false,
  );
  const [notice, setNotice] = useState<UnlockNotice | null>(null);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // In-flight biometric attempt: the controller aborts a hung/cancelled prompt,
  // and the monotonic id lets us ignore a late result (a prompt that resolves
  // after the user already switched to password or started a new attempt).
  const abortRef = useRef<AbortController | null>(null);
  const attemptIdRef = useRef(0);
  // Lets us re-focus the trigger synchronously inside the click handler, keeping
  // the document active when navigator.credentials.get() fires (matters for the
  // side panel surface).
  const biometricButtonRef = useRef<HTMLButtonElement | null>(null);

  const canSubmitPassword = password.trim().length > 0 && !isPasswordLoading;

  // Abandon any pending biometric attempt: invalidate its result, abort the OS
  // prompt, and leave the UI out of the "Waiting…" state. Used when the user
  // explicitly chooses password while a prompt is in flight.
  function cancelPendingBiometric() {
    attemptIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsBiometricLoading(false);
  }

  // Biometric unlock runs ONLY from an explicit user click (no auto-prompt in
  // any surface), so the WebAuthn call always carries a fresh user activation —
  // the fix for the "Waiting…" hang in fullscreen/sidepanel. The password form
  // stays visible throughout, so the user is never trapped in a pending state.
  async function handleBiometricUnlock() {
    if (!biometricConfig) return;

    const surface = getCurrentSurface();

    // Diagnostics captured at the very top of the click handler, BEFORE any
    // async work, so the logged user-activation state reflects the gesture that
    // is about to drive WebAuthn. All values are non-sensitive presence flags —
    // never the password, secret, PRF output, or full wrappedSecret.
    const activation = (
      navigator as Navigator & {
        userActivation?: { isActive?: boolean; hasBeenActive?: boolean };
      }
    ).userActivation;
    biometricDebug("unlock:click", {
      surface,
      hasFocus:
        typeof document !== "undefined" && typeof document.hasFocus === "function"
          ? document.hasFocus()
          : undefined,
      userActivationIsActive: activation?.isActive,
      userActivationHasBeenActive: activation?.hasBeenActive,
      hasConfig: Boolean(biometricConfig),
      hasCredentialId: Boolean(biometricConfig.credentialId),
      hasWrappedSecret: Boolean(biometricConfig.wrappedSecret),
    });

    // Keep focus inside this surface synchronously, within the gesture, before
    // the WebAuthn call — some surfaces (side panel) drop the OS prompt if the
    // document is not the active/focused context at get() time.
    biometricButtonRef.current?.focus();

    // Supersede any prior attempt and start a fresh, guarded one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const attemptId = ++attemptIdRef.current;
    let timedOut = false;

    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      biometricDebug("unlock:timeout", { ms: BIOMETRIC_TIMEOUT_MS });
      controller.abort();
    }, BIOMETRIC_TIMEOUT_MS);

    try {
      setNotice(null);
      setIsBiometricLoading(true);
      biometricDebug("unlock:start", { surface });

      // skipAvailabilityCheck: availability was already confirmed in state (the
      // button only renders when biometricUsable === true), so we go STRAIGHT to
      // navigator.credentials.get() with no intervening async hop that could eat
      // the transient user activation. This is the side-panel fix.
      const secret = await biometricUnlockService.unlock(biometricConfig, {
        signal: controller.signal,
        skipAvailabilityCheck: true,
      });
      // A late result from a superseded/cancelled attempt must not unlock or
      // touch the UI.
      if (attemptId !== attemptIdRef.current) {
        biometricDebug("unlock:ignored-late-result");
        return;
      }
      await walletService.unlockWallet({ password: secret });
      biometricDebug("unlock:success");
      await onUnlocked?.();
    } catch (error) {
      if (attemptId !== attemptIdRef.current) return;
      const code = error instanceof BiometricError ? error.code : "failed";
      biometricDebug("unlock:error", { code, timedOut });

      if (timedOut) {
        // Prompt never responded — leave a soft hint; the password form is
        // already visible so the user can proceed immediately.
        setNotice({ type: "info", message: t("unlock.biometricTimeout", { label }) });
      } else if (code === "cancelled") {
        // User dismissed the OS prompt — keep the biometric option visible so
        // they can retry, and never surface a crash or a re-prompt loop.
        setNotice({ type: "info", message: t("unlock.touchIdCancelled") });
      } else if (code === "unavailable" || code === "unsupported") {
        // Authenticator went away (or never supported the secure flow) — hide
        // the biometric option; password unlock continues to work.
        setBiometricUsable(false);
        setNotice({ type: "info", message: t("unlock.touchIdNotSetUp") });
      } else {
        // Includes a successful WebAuthn assertion whose secret failed to unlock
        // the wallet (decrypt/unlockWallet error) — fall back to password.
        setNotice({ type: "error", message: t("unlock.touchIdFailed") });
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
      // Only the current attempt owns the spinner; a superseded one already
      // cleared it via cancelPendingBiometric / a newer attempt.
      if (attemptId === attemptIdRef.current) {
        setIsBiometricLoading(false);
      }
    }
  }

  // Probe whether a platform authenticator is present, to decide if the
  // biometric BUTTON should appear. We deliberately do NOT auto-prompt in any
  // surface: WebAuthn needs a transient user activation, and an effect-driven
  // prompt (no user gesture) can hang on "Waiting…" in fullscreen/sidepanel.
  // Biometrics run only from an explicit click (handleBiometricUnlock). We still
  // consume the manual-lock suppression one-shot so the stored flag never
  // lingers (the suppression infra is preserved for a future auto-prompt).
  useEffect(() => {
    if (!biometricConfig) return;
    let active = true;
    consumeBiometricAutoPromptSuppression();
    const surface = getCurrentSurface();

    // Every surface — popup, fullscreen AND side panel — runs the same platform
    // authenticator probe to decide whether to render the biometric button. The
    // side panel is no longer hard-blocked: the actual WebAuthn call is driven
    // straight from the click handler with a fresh user activation (see
    // handleBiometricUnlock), which is what lets Chrome raise the OS prompt
    // there. We still never auto-prompt in any surface.
    void biometricUnlockService
      .isAvailable()
      .then((available) => {
        if (!active) return;
        biometricDebug("isAvailable", {
          surface,
          available,
          hasCredentialId: Boolean(biometricConfig.credentialId),
          hasWrappedSecret: Boolean(biometricConfig.wrappedSecret),
        });
        setBiometricUsable(available);
      })
      .catch(() => {
        if (!active) return;
        setBiometricUsable(false);
      });

    return () => {
      active = false;
      // Drop any in-flight prompt so it can't resolve into an unmounted tree.
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePasswordUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPassword) return;

    // Going the password route abandons any pending biometric prompt so a late
    // assertion can't hijack the UI after the wallet is already unlocking.
    cancelPendingBiometric();

    try {
      setNotice(null);
      setIsPasswordLoading(true);
      await walletService.unlockWallet({ password });
      biometricDebug("password:success");
      await onUnlocked?.();
    } catch {
      setNotice({ type: "error", message: t("unlock.wrongPassword") });
    } finally {
      setIsPasswordLoading(false);
    }
  }

  return (
    <div className="ext-popup" data-screen-label="02 Unlock">
      <div className="screen-body unlock-body">
        {/* Logo + title + subtitle */}
        <div className="unlock-hero">
          <img
            className="app-logo"
            src={logoUrl}
            alt="Simpl wallet"
            style={{ width: 160, height: "auto", objectFit: "contain" }}
          />
          <div className="t-h2 unlock-title">{t("unlock.title")}</div>
          <div className="unlock-subtitle">{t("unlock.subtitle")}</div>
        </div>

        {/* Inline notice (non-blocking) */}
        {notice ? (
          <div className={`unlock-notice unlock-notice--${notice.type}`}>
            {notice.message}
          </div>
        ) : null}

        {/* Primary actions — password is ALWAYS visible so the user can never be
            trapped in a biometric "Waiting…" state. Touch ID is an explicit,
            secondary action (no auto-prompt in any surface). */}
        <div className="unlock-actions">
          <form
            onSubmit={(e) => void handlePasswordUnlock(e)}
            className="unlock-password-form"
          >
            <div>
              <span className="field-label">{t("unlock.passwordLabel")}</span>
              <input
                className="input lg"
                type="password"
                placeholder={t("unlock.passwordPlaceholder")}
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
              {isPasswordLoading ? t("unlock.unlocking") : t("unlock.unlock")}
            </button>
          </form>

          {/* Biometric quick action — only when a usable credential exists, and
              only triggered by this click (carries a fresh user activation). */}
          {biometricUsable === true ? (
            <button
              ref={biometricButtonRef}
              className="btn secondary lg full"
              type="button"
              onClick={() => void handleBiometricUnlock()}
              disabled={isBiometricLoading || isPasswordLoading}
            >
              <BiometricIcon />
              {isBiometricLoading
                ? t("unlock.waitingTouchId", { label })
                : t("unlock.withTouchId", { label })}
            </button>
          ) : null}

          {/* Explicit escape while a prompt is pending (password is also always
              available above). Cancels the attempt and clears the spinner. */}
          {isBiometricLoading ? (
            <button
              className="btn ghost full"
              type="button"
              onClick={() => {
                cancelPendingBiometric();
                setNotice(null);
              }}
              style={{ height: 34, fontSize: 12, color: "var(--ink-3)" }}
            >
              {t("unlock.usePassword")}
            </button>
          ) : null}
        </div>

        {/* Security assurance card */}
        <div className="unlock-security-card">
          <div className="unlock-security-card__title">
            {t("unlock.securityTitle")}
          </div>
          <div className="unlock-security-card__body">
            {t("unlock.securityBody")}
          </div>
        </div>

        {/* Restore link */}
        <button
          className="btn ghost full"
          type="button"
          onClick={onRestoreFromSeed}
          style={{ height: 34, fontSize: 12, color: "var(--ink-3)" }}
        >
          {t("unlock.forgotPassword")}
        </button>
      </div>
    </div>
  );
}

export default UnlockPage;
