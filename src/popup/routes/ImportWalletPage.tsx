// src/popup/routes/ImportWalletPage.tsx

import { useState } from "react";
import { walletService } from "../../core/wallet/wallet.service";

type ImportWalletPageProps = {
  onImported: () => void | Promise<void>;
  onBack: () => void;
};

type ImportStep = "seed" | "password";

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function ImportIcon() {
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
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
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

function normalizeSeedPhrase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getSeedWords(value: string): string[] {
  const normalized = normalizeSeedPhrase(value);

  if (!normalized) return [];

  return normalized.split(" ").filter(Boolean);
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

export function ImportWalletPage({
  onImported,
  onBack,
}: ImportWalletPageProps) {
  const [step, setStep] = useState<ImportStep>("seed");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seedWords = getSeedWords(seedPhrase);
  const wordCount = seedWords.length;
  const seedLooksValid = wordCount === 12 || wordCount === 24;

  const passwordLongEnough = password.length >= 8;
  const passwordHasLetter = /[a-zA-Z]/.test(password);
  const passwordHasNumber = /\d/.test(password);
  const passwordLooksValid =
    passwordLongEnough && passwordHasLetter && passwordHasNumber;

  function handleBack() {
    if (step === "password") {
      setStep("seed");
      setError(null);
      return;
    }

    onBack();
  }

  function continueFromSeed() {
    setError(null);

    if (!seedPhrase.trim()) {
      setError("Enter your seed phrase.");
      return;
    }

    if (!seedLooksValid) {
      setError("Seed phrase must contain 12 or 24 words.");
      return;
    }

    setSeedPhrase(normalizeSeedPhrase(seedPhrase));
    setStep("password");
  }

  async function importWallet() {
    setError(null);

    if (!seedLooksValid) {
      setStep("seed");
      setError("Seed phrase must contain 12 or 24 words.");
      return;
    }

    if (!passwordLooksValid) {
      setError("Password must contain at least 8 characters, one letter and one number.");
      return;
    }

    setImporting(true);

    try {
      await walletService.importWallet({
        mnemonic: normalizeSeedPhrase(seedPhrase),
        password,
      });

      await onImported();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="ext-popup" data-screen-label="03 Import Wallet">
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
          Import wallet
        </div>

        <span style={{ flex: 1 }} />

        <span className="pill">{step === "seed" ? "Seed" : "Password"}</span>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gap: 16,
        }}
      >
        {step === "seed" ? (
          <>
            <section style={{ paddingTop: 6 }}>
              <div
                className="lbl"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 14,
                }}
              >
                Restore wallet
              </div>

              <div className="t-h2">
                Import
                <br />
                wallet
              </div>

              <p
                style={{
                  margin: "10px 0 0",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                Enter your 12 or 24 word seed phrase. Password setup comes next.
              </p>
            </section>

            {error ? (
              <Notice title="Import error" tone="danger">
                {error}
              </Notice>
            ) : null}

            <form
              style={{ display: "grid", gap: 12 }}
              onSubmit={(event) => {
                event.preventDefault();
                continueFromSeed();
              }}
            >
              <label style={{ display: "grid", gap: 8 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span
                    className="lbl"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    Seed phrase
                  </span>

                  <span
                    style={{
                      color: seedLooksValid ? "var(--secure)" : "var(--ink-3)",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {wordCount} words
                  </span>
                </div>

                <textarea
                  className="input lg"
                  value={seedPhrase}
                  placeholder="word1 word2 word3 ..."
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setSeedPhrase(event.target.value);
                    setError(null);
                  }}
                  style={{
                    minHeight: 128,
                    resize: "none",
                    lineHeight: 1.5,
                    paddingTop: 14,
                  }}
                />
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
                <RuleRow valid={wordCount > 0} label="Phrase entered" />
                <RuleRow valid={seedLooksValid} label="12 or 24 words" />
              </section>

              <Notice title="Password comes next" tone="warning">
                First we validate the phrase, then encrypt it locally on this device.
              </Notice>

              <button
                className="btn primary lg full"
                type="submit"
                disabled={!seedLooksValid}
              >
                Continue
              </button>
            </form>
          </>
        ) : null}

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
                <ImportIcon />
              </div>

              <div className="t-h2">
                Set
                <br />
                password
              </div>

              <p
                style={{
                  margin: "10px 0 0",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                This password encrypts your wallet on this device. SIMPLE cannot
                recover it.
              </p>
            </section>

            {error ? (
              <Notice title="Import error" tone="danger">
                {error}
              </Notice>
            ) : null}

            <form
              style={{ display: "grid", gap: 12 }}
              onSubmit={(event) => {
                event.preventDefault();
                void importWallet();
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
                  Wallet password
                </span>

                <div style={{ position: "relative" }}>
                  <input
                    className="input lg"
                    type={passwordVisible ? "text" : "password"}
                    value={password}
                    placeholder="strong-password-123"
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
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
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
                <RuleRow valid={passwordLongEnough} label="At least 8 characters" />
                <RuleRow valid={passwordHasLetter} label="Contains a letter" />
                <RuleRow valid={passwordHasNumber} label="Contains a number" />
                <RuleRow valid={seedLooksValid} label="Seed phrase ready" />
              </section>

              <Notice title="Local encryption" tone="success">
                Your seed phrase is encrypted locally. Keep your password and seed phrase safe.
              </Notice>

              <button
                className="btn primary lg full"
                type="submit"
                disabled={!passwordLooksValid || importing}
              >
                {importing ? "Importing…" : "Import wallet"}
              </button>

              <button
                className="btn secondary lg full"
                type="button"
                onClick={() => {
                  setStep("seed");
                  setError(null);
                }}
                disabled={importing}
              >
                Edit seed phrase
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default ImportWalletPage;
