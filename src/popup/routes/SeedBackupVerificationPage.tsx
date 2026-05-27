import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { walletService } from "../../core/wallet/wallet.service";

type VerificationStep = "password" | "review" | "quiz" | "done";

type SeedChallenge = {
  index: number;
  correctWord: string;
  options: string[];
};

type RevealSeedResult =
  | string
  | {
      mnemonic?: string;
      seedPhrase?: string;
      phrase?: string;
    };

type SeedBackupVerificationPageProps = {
  onBack?: () => void;
  onVerified?: () => void | Promise<void>;
  allowBack?: boolean;
};

function normalizeMnemonic(result: RevealSeedResult): string {
  if (typeof result === "string") {
    return result;
  }

  return result.mnemonic ?? result.seedPhrase ?? result.phrase ?? "";
}

function getRevealSeedFunction():
  | ((input: { password: string }) => Promise<RevealSeedResult>)
  | undefined {
  const service = walletService as unknown as {
    revealSeedPhrase?: (input: { password: string }) => Promise<RevealSeedResult>;
    revealMnemonic?: (input: { password: string }) => Promise<RevealSeedResult>;
  };

  if (typeof service.revealSeedPhrase === "function") {
    const revealSeedPhrase = service.revealSeedPhrase;

    return (input: { password: string }) =>
      revealSeedPhrase.call(walletService, input);
  }

  if (typeof service.revealMnemonic === "function") {
    const revealMnemonic = service.revealMnemonic;

    return (input: { password: string }) =>
      revealMnemonic.call(walletService, input);
  }

  return undefined;
}

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];

    result[index] = result[randomIndex];
    result[randomIndex] = current;
  }

  return result;
}

function createChallenges(words: string[]): SeedChallenge[] {
  const challengeCount = Math.min(3, words.length);
  const indexes = shuffleArray(words.map((_, index) => index))
    .slice(0, challengeCount)
    .sort((left, right) => left - right);

  return indexes.map((index) => {
    const correctWord = words[index];

    const uniqueDecoys = Array.from(
      new Set(
        words.filter(
          (word, wordIndex) => wordIndex !== index && word !== correctWord,
        ),
      ),
    );

    const decoys = shuffleArray(uniqueDecoys).slice(0, 3);
    const options = shuffleArray([correctWord, ...decoys]);

    return {
      index,
      correctWord,
      options,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function getChromeStorageLocal() {
  return (globalThis as unknown as {
    chrome?: {
      storage?: {
        local?: {
          get?: (
            keys: string[] | string | null,
            callback: (items: Record<string, unknown>) => void,
          ) => void;
          set?: (items: Record<string, unknown>, callback?: () => void) => void;
        };
      };
    };
  }).chrome?.storage?.local;
}

function chromeStorageGet(keys: string[] | string | null): Promise<Record<string, unknown>> {
  const storage = getChromeStorageLocal();
  const get = storage?.get;

  if (!storage || typeof get !== "function") {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    try {
      get.call(storage, keys, (items: Record<string, unknown>) => {
        resolve(items ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  const storage = getChromeStorageLocal();
  const set = storage?.set;

  if (!storage || typeof set !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      set.call(storage, items, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function markSeedBackupVerified() {
  const now = new Date().toISOString();

  const patch = {
    seedBackupConfirmed: true,
    seedBackupConfirmedAt: now,
    seedBackupVerified: true,
    seedBackupVerifiedAt: now,
  };

  const stored = await chromeStorageGet(["securitySettings", "settings", "walletState"]);

  const currentSecuritySettings = asRecord(stored.securitySettings);
  const currentSettings = asRecord(stored.settings);
  const currentSettingsSecurity = asRecord(currentSettings.security);
  const currentWalletState = asRecord(stored.walletState);
  const currentWalletStateSettings = asRecord(currentWalletState.settings);
  const currentWalletStateSecurity = asRecord(currentWalletStateSettings.security);

  const nextSecuritySettings = {
    ...currentSecuritySettings,
    ...patch,
  };

  const nextSettings = {
    ...currentSettings,
    security: {
      ...currentSettingsSecurity,
      ...patch,
    },
  };

  const payload: Record<string, unknown> = {
    securitySettings: nextSecuritySettings,
    settings: nextSettings,
  };

  if (Object.keys(currentWalletState).length > 0) {
    payload.walletState = {
      ...currentWalletState,
      settings: {
        ...currentWalletStateSettings,
        security: {
          ...currentWalletStateSecurity,
          ...patch,
        },
      },
    };
  }

  await chromeStorageSet(payload);

  try {
    localStorage.setItem("securitySettings", JSON.stringify(nextSecuritySettings));
    localStorage.setItem("settings", JSON.stringify(nextSettings));

    if (payload.walletState) {
      localStorage.setItem("walletState", JSON.stringify(payload.walletState));
    }
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

export default function SeedBackupVerificationPage({
  onBack,
  onVerified,
  allowBack = true,
}: SeedBackupVerificationPageProps) {
  const [step, setStep] = useState<VerificationStep>("password");
  const [password, setPassword] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const challenges = useMemo(() => createChallenges(words), [words]);

  const canVerify =
    challenges.length > 0 &&
    challenges.every((challenge) => answers[challenge.index] === challenge.correctWord);

  const revealSeed = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!password.trim()) {
      setError("Enter wallet password first.");
      return;
    }

    const reveal = getRevealSeedFunction();

    if (!reveal) {
      setError("Seed phrase reveal method is not available.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await reveal({ password });
      const mnemonic = normalizeMnemonic(result);
      const nextWords = mnemonic.trim().split(/\s+/).filter(Boolean);

      if (nextWords.length < 12) {
        setError("Seed phrase is unavailable or has an invalid format.");
        return;
      }

      setWords(nextWords);
      setAnswers({});
      setStep("review");
    } catch {
      setError("Wrong password or seed phrase could not be revealed.");
    } finally {
      setIsLoading(false);
    }
  };

  const verifyBackup = async () => {
    if (!canVerify) {
      setError("Select the correct words to verify your backup.");
      return;
    }

    setError(null);
    setStep("done");

    await markSeedBackupVerified();
    await onVerified?.();

    setPassword("");
    setWords([]);
    setAnswers({});
  };

  return (
    <main
      style={{
        height: "100vh",
        minHeight: "100vh",
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--bg, #ffffff)",
        color: "var(--text-primary, #111111)",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          height: 56,
          borderBottom: "1px solid var(--border, #e8e8e8)",
          background: "var(--bg, #ffffff)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 680,
            height: "100%",
            margin: "0 auto",
            padding: "0 12px",
            boxSizing: "border-box",
            display: "grid",
            gridTemplateColumns: "44px 1fr 44px",
            alignItems: "center",
          }}
        >
          {allowBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              style={{
                width: 36,
                height: 36,
                border: 0,
                background: "transparent",
                color: "var(--text-primary, #111111)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <BackIcon />
            </button>
          ) : (
            <div />
          )}

          <div
            style={{
              fontSize: 15,
              lineHeight: "20px",
              fontWeight: 800,
            }}
          >
            Verify backup
          </div>

          <div />
        </div>
      </header>

      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
          padding: "52px 12px 88px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            margin: 0,
            maxWidth: 520,
            fontSize: 46,
            lineHeight: "50px",
            letterSpacing: "-0.055em",
            fontWeight: 900,
          }}
        >
          Verify recovery phrase
        </h1>

        <p
          style={{
            margin: "14px 0 0",
            maxWidth: 560,
            color: "var(--text-secondary, #777777)",
            fontSize: 14,
            lineHeight: "21px",
          }}
        >
          Confirm that your recovery phrase is written down and stored safely offline.
        </p>

        {step === "password" ? (
          <form
            onSubmit={revealSeed}
            style={{
              marginTop: 34,
              display: "grid",
              gap: 12,
            }}
          >
            <label
              style={{
                display: "grid",
                gap: 8,
              }}
            >
              <span
                style={{
                  color: "var(--text-primary, #111111)",
                  fontSize: 12,
                  lineHeight: "16px",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                }}
              >
                Wallet password
              </span>

              <input
                className="input lg"
                type="password"
                value={password}
                placeholder="Enter wallet password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <button
              type="submit"
              className="btn primary lg full"
              disabled={isLoading}
            >
              {isLoading ? "Checking…" : "Reveal recovery phrase"}
            </button>
          </form>
        ) : null}

        {step === "review" ? (
          <section style={{ marginTop: 34 }}>
            <div
              style={{
                margin: "0 0 12px",
                color: "var(--text-primary, #111111)",
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              Write it down
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              {words.map((word, index) => (
                <div
                  key={`${word}-${index}`}
                  style={{
                    border: "1px solid var(--border, #dedede)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    background: "var(--bg, #ffffff)",
                    display: "grid",
                    gridTemplateColumns: "24px 1fr",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 13,
                    lineHeight: "18px",
                    fontWeight: 800,
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-secondary, #777777)",
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span>{word}</span>
                </div>
              ))}
            </div>

            <p
              style={{
                margin: "16px 0 0",
                color: "var(--text-secondary, #777777)",
                fontSize: 13,
                lineHeight: "19px",
              }}
            >
              Never share this phrase with anyone. SIMPLE will ask you to select
              three random words next.
            </p>

            <button
              type="button"
              className="btn primary lg full"
              onClick={() => {
                setError(null);
                setStep("quiz");
              }}
              style={{ marginTop: 16 }}
            >
              Continue to verification
            </button>
          </section>
        ) : null}

        {step === "quiz" ? (
          <section style={{ marginTop: 34 }}>
            <div
              style={{
                margin: "0 0 12px",
                color: "var(--text-primary, #111111)",
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              Select words
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              {challenges.map((challenge) => (
                <div key={challenge.index}>
                  <div
                    style={{
                      marginBottom: 8,
                      fontSize: 15,
                      lineHeight: "20px",
                      fontWeight: 800,
                    }}
                  >
                    Select word #{challenge.index + 1}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 8,
                    }}
                  >
                    {challenge.options.map((option) => {
                      const selected = answers[challenge.index] === option;

                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setAnswers((current) => ({
                              ...current,
                              [challenge.index]: option,
                            }));
                            setError(null);
                          }}
                          style={{
                            border: selected
                              ? "1px solid var(--text-primary, #111111)"
                              : "1px solid var(--border, #dedede)",
                            background: selected
                              ? "var(--text-primary, #111111)"
                              : "var(--bg, #ffffff)",
                            color: selected ? "#ffffff" : "var(--text-primary, #111111)",
                            borderRadius: 12,
                            padding: "12px 14px",
                            cursor: "pointer",
                            fontSize: 14,
                            lineHeight: "18px",
                            fontWeight: 800,
                            textAlign: "center",
                          }}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn primary lg full"
              onClick={verifyBackup}
              disabled={!canVerify}
              style={{ marginTop: 18 }}
            >
              Verify backup
            </button>
          </section>
        ) : null}

        {step === "done" ? (
          <section style={{ marginTop: 34 }}>
            <div
              style={{
                border: "1px solid var(--border, #dedede)",
                borderRadius: 16,
                padding: 18,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  lineHeight: "24px",
                  fontWeight: 850,
                }}
              >
                Backup verified
              </div>

              <p
                style={{
                  margin: "6px 0 0",
                  color: "var(--text-secondary, #777777)",
                  fontSize: 13,
                  lineHeight: "19px",
                }}
              >
                Recovery phrase verification is complete.
              </p>
            </div>
          </section>
        ) : null}

        {error ? (
          <div
            style={{
              marginTop: 14,
              color: "#a23b2d",
              fontSize: 13,
              lineHeight: "19px",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </section>
    </main>
  );
}
