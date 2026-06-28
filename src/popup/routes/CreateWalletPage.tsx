// src/popup/routes/CreateWalletPage.tsx

import { useState } from "react";
import { walletService } from "../../core/wallet/wallet.service";
import { useTranslation } from "../../i18n";

type CreateWalletPageProps = {
  onCreated: () => void | Promise<void>;
  onBack: () => void;
};

type CreateStep = "password" | "backup";

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8" />
      <path d="M16 4l4 4" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EyeIcon() {
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
      <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function EyeOffIcon() {
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
      <path d="M4 4l16 16" />
      <path d="M9.5 6.9A8 8 0 0 1 12 6.5c5.3 0 8.5 5.5 8.5 5.5a14 14 0 0 1-2.6 3.1" />
      <path d="M14.1 14.1a2.7 2.7 0 0 1-3.8-3.8" />
      <path d="M6.3 8.3C4.5 9.8 3.5 12 3.5 12s3.2 5.5 8.5 5.5c1.2 0 2.3-.3 3.3-.7" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function RuleRow({
  valid,
  label,
}: {
  valid: boolean;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: valid ? "var(--secure)" : "var(--ink-3)",
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: valid ? "var(--secure-soft)" : "var(--bg-sunken)",
          color: valid ? "var(--secure)" : "var(--ink-4)",
          flex: "0 0 18px",
        }}
      >
        {valid ? "✓" : "·"}
      </span>

      <span>{label}</span>
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warning" | "danger" | "success";
  title: string;
  children: string;
}) {
  const styles =
    tone === "success"
      ? {
          background: "var(--secure-soft)",
          color: "var(--secure)",
        }
      : tone === "danger"
        ? {
            background: "var(--danger-soft)",
            color: "var(--danger)",
          }
        : {
            background: "var(--warn-soft)",
            color: "var(--warn)",
          };

  return (
    <section
      style={{
        ...styles,
        borderRadius: 16,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "32px 1fr",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <div
        className="tok"
        style={{
          width: 32,
          height: 32,
          minWidth: 32,
          maxWidth: 32,
          background: "rgba(255,255,255,0.55)",
          color: "currentColor",
        }}
      >
        {tone === "success" ? <CheckIcon /> : <AlertIcon />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 750,
            color: "currentColor",
          }}
        >
          {title}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            lineHeight: 1.45,
            color: "currentColor",
            opacity: 0.82,
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";

  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function CreateWalletPage({
  onCreated,
  onBack,
}: CreateWalletPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CreateStep>("password");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordLongEnough = password.length >= 8;
  const passwordHasLetter = /[a-zA-Z]/.test(password);
  const passwordHasNumber = /\d/.test(password);
  const passwordLooksValid =
    passwordLongEnough && passwordHasLetter && passwordHasNumber;

  const words = mnemonic ? mnemonic.split(" ") : [];

  function handleBack() {
    if (step === "backup") {
      setStep("password");
      setError(null);
      return;
    }

    onBack();
  }

  async function createWallet() {
    setError(null);

    if (!passwordLooksValid) {
      setError(t("create.passwordError"));
      return;
    }

    setCreating(true);

    try {
      const result = await walletService.createNewWallet({
        password,
        wordCount: 12,
      });

      setMnemonic(result.mnemonic);
      setStep("backup");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }

  async function copySeedPhrase() {
    if (!mnemonic) return;

    await copyText(mnemonic);

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 1600);
  }

  async function finishBackup() {
    await onCreated();
  }

  return (
    <div className="ext-popup" data-screen-label="02 Create Wallet">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={handleBack}>
          <BackIcon />
        </button>

        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: "var(--ink-1)",
          }}
        >
          {t("create.title")}
        </div>

        <span style={{ flex: 1 }} />

        <span className="pill">{step === "password" ? t("create.stepPassword") : t("create.stepBackup")}</span>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gap: 16,
        }}
      >
        {step === "password" ? (
          <>
            <section style={{ paddingTop: 6 }}>
              <div
                className="tok"
                style={{
                  width: 46,
                  height: 46,
                  minWidth: 46,
                  maxWidth: 46,
                  marginBottom: 14,
                  background: "var(--ink-1)",
                  color: "var(--ink-on-dark)",
                }}
              >
                <KeyIcon />
              </div>

              <div className="t-h2">
                {t("create.headerCreate")}
                <br />
                {t("create.headerWallet")}
              </div>

              <p
                style={{
                  margin: "10px 0 0",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {t("create.passwordDesc")}
              </p>
            </section>

            {error ? (
              <Notice title={t("create.errorTitle")} tone="danger">
                {error}
              </Notice>
            ) : null}

            <form
              style={{ display: "grid", gap: 12 }}
              onSubmit={(event) => {
                event.preventDefault();
                void createWallet();
              }}
            >
              <label style={{ display: "grid", gap: 8 }}>
                <span
                  className="lbl"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  {t("common.walletPassword")}
                </span>

                <div style={{ position: "relative" }}>
                  <input
                    className="input lg"
                    type={passwordVisible ? "text" : "password"}
                    value={password}
                    placeholder={t("create.passwordPlaceholder")}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError(null);
                    }}
                    style={{ paddingRight: 52 }}
                  />

                  <button
                    type="button"
                    onClick={() => setPasswordVisible((value) => !value)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 32,
                      height: 32,
                      border: 0,
                      borderRadius: 10,
                      background: "transparent",
                      color: "var(--ink-3)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    aria-label={passwordVisible ? t("common.hidePassword") : t("common.showPassword")}
                  >
                    {passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </label>

              <section
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 16,
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <RuleRow valid={passwordLongEnough} label={t("create.rule8")} />
                <RuleRow valid={passwordHasLetter} label={t("create.ruleLetter")} />
                <RuleRow valid={passwordHasNumber} label={t("create.ruleNumber")} />
              </section>

              <Notice title={t("create.localEncryption")} tone="success">
                {t("create.localEncryptionBody")}
              </Notice>

              <button
                className="btn primary lg full"
                type="submit"
                disabled={!passwordLooksValid || creating}
              >
                {creating ? t("common.creating") : t("create.createButton")}
              </button>
            </form>
          </>
        ) : null}

        {step === "backup" && mnemonic ? (
          <>
            <section style={{ paddingTop: 6 }}>
              <div
                className="tok"
                style={{
                  width: 46,
                  height: 46,
                  minWidth: 46,
                  maxWidth: 46,
                  marginBottom: 14,
                  background: "var(--warn-soft)",
                  color: "var(--warn)",
                }}
              >
                <AlertIcon />
              </div>

              <div className="t-h2">
                {t("create.headerBackup")}
                <br />
                {t("create.headerSeedPhrase")}
              </div>

              <p
                style={{
                  margin: "10px 0 0",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {t("create.backupDesc")}
              </p>
            </section>

            <Notice title={t("create.importantTitle")} tone="warning">
              {t("create.seedWarningBody")}
            </Notice>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {words.map((word, index) => (
                <div
                  key={`${word}-${index}`}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    background: "var(--bg-surface)",
                    padding: "9px 10px",
                    display: "grid",
                    gridTemplateColumns: "22px 1fr",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      color: "var(--ink-4)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {index + 1}
                  </span>

                  <strong
                    style={{
                      color: "var(--ink-1)",
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {word}
                  </strong>
                </div>
              ))}
            </section>

            <button
              className={copied ? "btn primary lg full" : "btn secondary lg full"}
              type="button"
              onClick={() => void copySeedPhrase()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? t("common.copied") : t("create.copySeed")}
            </button>

            <button
              className="btn primary lg full"
              type="button"
              onClick={() => void finishBackup()}
            >
              {t("create.savedIt")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CreateWalletPage;
