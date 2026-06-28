// src/popup/routes/RevealSeedPage.tsx
//
// Sensitive recovery screen — reveals the wallet seed phrase after the user
// re-enters the wallet password. Uses the shared wallet shell (.ext-popup /
// .screen-body) so it matches Home / Settings in popup, sidepanel, and
// fullscreen.
//
// Security:
//   • The mnemonic is only requested after a password confirmation and lives in
//     local React state — never persisted, logged, or put in the URL/route.
//   • State is cleared on unmount and via the "Hide" action.
//   • walletService.revealSeedPhrase (crypto path) is unchanged.

import { useEffect, useState } from "react";
import { walletService } from "../../core/wallet/wallet.service";
import { Notice } from "../components/Notice";
import { useTranslation } from "../../i18n";

type RevealSeedPageProps = {
  onBack: () => void;
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

function PhraseIcon() {
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
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M7 9.5h6M7 13h8M7 16.5h4" />
    </svg>
  );
}

export function RevealSeedPage({ onBack }: RevealSeedPageProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Defensively clear the secret if this component unmounts (navigation away).
  useEffect(() => {
    return () => {
      setMnemonic(null);
      setPassword("");
    };
  }, []);

  async function reveal() {
    if (busy || !password) return;
    setError(null);
    setBusy(true);

    try {
      const result = await walletService.revealSeedPhrase({ password });
      setMnemonic(result.mnemonic);
      setPassword("");
    } catch {
      setError(t("backup.incorrectPassword"));
    } finally {
      setBusy(false);
    }
  }

  function hide() {
    setMnemonic(null);
    setCopied(false);
    setError(null);
  }

  async function copyPhrase() {
    if (!mnemonic) return;
    try {
      await copyToClipboard(mnemonic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in this context.
    }
  }

  const words = mnemonic ? mnemonic.trim().split(/\s+/) : [];

  return (
    <div className="ext-popup import-acct-page reveal-page" data-screen-label="Reveal seed">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>
        <span className="import-acct-title">{t("backup.revealSeed")}</span>
        <span className="reveal-bar-icon" aria-hidden="true">
          <ShieldIcon />
        </span>
      </div>

      <div className="screen-body reveal-body">
        {!mnemonic ? (
          <>
            <div className="reveal-hero">
              <span className="reveal-hero__icon">
                <PhraseIcon />
              </span>
              <div className="reveal-hero__text">
                <div className="reveal-hero__title">{t("backup.recoveryPhrase")}</div>
                <div className="reveal-hero__sub">
                  {t("backup.revealSeedSub")}
                </div>
              </div>
            </div>

            <Notice tone="warning" title={t("common.sensitiveInfo")}>
              {t("backup.sensitiveBody")}
            </Notice>

            <div className="import-acct-field">
              <label className="import-acct-field-label" htmlFor="reveal-seed-pwd">
                {t("common.walletPassword")}
              </label>
              <input
                id="reveal-seed-pwd"
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
              {busy ? t("common.revealing") : t("backup.revealSeed")}
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
            <p className="reveal-subtle">
              {t("backup.writeDownInstructions", { count: words.length })}
            </p>

            <div className="reveal-seed-grid">
              {words.map((word, index) => (
                <div className="reveal-seed-word" key={`${word}-${index}`}>
                  <span className="reveal-seed-word__num">{index + 1}</span>
                  <span className="reveal-seed-word__text">{word}</span>
                </div>
              ))}
            </div>

            <Notice tone="warning" title={t("backup.keepOffline")}>
              {t("backup.keepOfflineBody")}
            </Notice>

            <div className="reveal-actions">
              <button
                type="button"
                className={`btn secondary lg${copied ? " reveal-copied" : ""}`}
                onClick={() => void copyPhrase()}
              >
                {copied ? t("common.copied") : t("backup.copyPhrase")}
              </button>
              <button
                type="button"
                className="btn secondary lg"
                onClick={hide}
              >
                {t("backup.hidePhrase")}
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

export default RevealSeedPage;
