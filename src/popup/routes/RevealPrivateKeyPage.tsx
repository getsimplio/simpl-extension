// src/popup/routes/RevealPrivateKeyPage.tsx
//
// Sensitive recovery screen — reveals the private key for the selected account
// after the user re-enters the wallet password. Uses the shared wallet shell
// (.ext-popup / .screen-body) so it matches Home / Settings in popup,
// sidepanel, and fullscreen.
//
// Security:
//   • The key is only requested after a password confirmation and lives in
//     local React state — never persisted, logged, or put in the URL/route.
//   • State is cleared on unmount and via the "Hide" action.
//   • walletService.revealPrivateKey (crypto path) is unchanged.

import { useEffect, useState } from "react";
import { walletService } from "../../core/wallet/wallet.service";
import { AccountBlockie } from "../components/AccountBlockie";
import { Notice } from "../components/Notice";
import { useTranslation } from "../../i18n";

type RevealPrivateKeyPageProps = {
  onBack: () => void;
};

type RevealedAccount = {
  label: string;
  address: string;
};

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
      <path d="M9.5 12l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.2 11.2l8.3 8.3M16 16l2-2M13.7 13.7l1.6 1.6" />
    </svg>
  );
}

export function RevealPrivateKeyPage({ onBack }: RevealPrivateKeyPageProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [account, setAccount] = useState<RevealedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Defensively clear the secret if this component unmounts (navigation away).
  useEffect(() => {
    return () => {
      setPrivateKey(null);
      setPassword("");
    };
  }, []);

  async function reveal() {
    if (busy || !password) return;
    setError(null);
    setBusy(true);

    try {
      const result = await walletService.revealPrivateKey({ password });
      setPrivateKey(result.privateKey);
      setAccount({
        label: result.account.label,
        address: result.account.address,
      });
      setPassword("");
    } catch (revealError) {
      const message =
        revealError instanceof Error ? revealError.message : "";
      // Surface meaningful domain errors (watch-only / missing key); otherwise
      // treat it as a wrong-password failure.
      if (message && /watch|missing|re-import/i.test(message)) {
        setError(message);
      } else {
        setError(t("backup.incorrectPassword"));
      }
    } finally {
      setBusy(false);
    }
  }

  function hide() {
    setPrivateKey(null);
    setCopied(false);
    setError(null);
  }

  async function copyKey() {
    if (!privateKey) return;
    try {
      await copyToClipboard(privateKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in this context.
    }
  }

  return (
    <div
      className="ext-popup import-acct-page reveal-page"
      data-screen-label="Reveal key"
    >
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>
        <span className="import-acct-title">{t("backup.revealKeyTitle")}</span>
        <span className="reveal-bar-icon" aria-hidden="true">
          <ShieldIcon />
        </span>
      </div>

      <div className="screen-body reveal-body">
        {!privateKey ? (
          <>
            <div className="reveal-hero">
              <span className="reveal-hero__icon">
                <KeyIcon />
              </span>
              <div className="reveal-hero__text">
                <div className="reveal-hero__title">{t("backup.revealKeyHeroTitle")}</div>
                <div className="reveal-hero__sub">
                  {t("backup.revealKeyHeroSub")}
                </div>
              </div>
            </div>

            <Notice tone="warning" title={t("common.sensitiveInfo")}>
              {t("backup.keyShareWarning")}
            </Notice>

            <div className="import-acct-field">
              <label className="import-acct-field-label" htmlFor="reveal-key-pwd">
                {t("common.walletPassword")}
              </label>
              <input
                id="reveal-key-pwd"
                className="import-acct-input"
                type="password"
                placeholder={t("common.enterPassword")}
                value={password}
                autoComplete="current-password"
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void reveal();
                }}
              />
            </div>

            {error ? (
              <Notice tone="danger" title={t("backup.couldntReveal")}>
                {error}
              </Notice>
            ) : null}

            <button
              type="button"
              className="btn primary lg full"
              onClick={() => void reveal()}
              disabled={busy || !password}
            >
              {busy ? t("common.revealing") : t("backup.revealKeyTitle")}
            </button>

            <button
              type="button"
              className="btn secondary lg full"
              onClick={onBack}
            >
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            {account ? (
              <div className="reveal-acct">
                <AccountBlockie address={account.address} size={38} />
                <div className="reveal-acct__body">
                  <div className="reveal-acct__name">{account.label}</div>
                  <div className="reveal-acct__addr">
                    {shortAddress(account.address)}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="reveal-secret">
              <div className="reveal-secret__label">{t("backup.revealKeyHeroTitle")}</div>
              <code className="reveal-secret__value">{privateKey}</code>
            </div>

            <Notice tone="warning" title={t("backup.keepKeyPrivate")}>
              {t("backup.keepKeyPrivateBody")}
            </Notice>

            <div className="reveal-actions">
              <button
                type="button"
                className={`btn secondary lg${copied ? " reveal-copied" : ""}`}
                onClick={() => void copyKey()}
              >
                {copied ? t("common.copied") : t("backup.copyPrivateKey")}
              </button>
              <button
                type="button"
                className="btn secondary lg"
                onClick={hide}
              >
                {t("backup.hideKey")}
              </button>
            </div>

            <button
              type="button"
              className="btn primary lg full"
              onClick={onBack}
            >
              {t("common.done")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default RevealPrivateKeyPage;
