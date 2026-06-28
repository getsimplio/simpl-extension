// src/popup/routes/WelcomePage.tsx

import { useState } from "react";

import logoUrl from "../../assets/simpl-logo.png";
import { useTranslation } from "../../i18n";
import { PreferencesSheet } from "../components/PreferencesSheet";

type WelcomePageProps = {
  onCreateWallet: () => void;
  onImportWallet: () => void;
  onAddWatchWallet: () => void;
};

function ArrowIcon() {
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
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
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

function WatchIcon() {
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
      <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function ShieldIcon() {
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
      <path d="M12 3l7 3v5c0 4.5-2.8 8.5-7 10-4.2-1.5-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function GearIcon() {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function WelcomePage({
  onCreateWallet,
  onImportWallet,
  onAddWatchWallet,
}: WelcomePageProps) {
  const { t } = useTranslation();
  const [prefsOpen, setPrefsOpen] = useState(false);

  return (
    <div className="ext-popup" data-screen-label="01 Welcome">
      <div className="bar-top">
        <img
          className="app-logo"
          src={logoUrl}
          alt="Simpl wallet"
          style={{ height: 28, width: "auto", objectFit: "contain" }}
        />

        <span style={{ flex: 1 }} />

        <button
          type="button"
          className="onboarding-prefs-btn"
          onClick={() => setPrefsOpen(true)}
          aria-haspopup="dialog"
        >
          <GearIcon />
          <span>{t("welcome.preferences")}</span>
        </button>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 14,
          minWidth: 0,
        }}
      >
        <section style={{ paddingTop: 8, minWidth: 0 }}>
          <div
            className="lbl"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            {t("welcome.badge")}
          </div>

          <div
            className="t-h2"
            style={{
              fontSize: 28,
              lineHeight: 1.0,
              letterSpacing: "-0.05em",
            }}
          >
            {t("welcome.titleLine1")}
            <br />
            {t("welcome.titleLine2")}
            <br />
            {t("welcome.titleLine3")}
          </div>

          <p
            style={{
              margin: "12px 0 0",
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
              maxWidth: "100%",
            }}
          >
            {t("welcome.subtitle")}
          </p>
        </section>

        <section
          style={{
            display: "grid",
            alignContent: "end",
            gap: 10,
          }}
        >
          <button
            type="button"
            className="btn primary lg full"
            onClick={onCreateWallet}
          >
            {t("welcome.createWallet")}
            <ArrowIcon />
          </button>

          <div className="row-list">
            <button
              type="button"
              className="row"
              onClick={onImportWallet}
              style={{
                border: 0,
                background: "transparent",
                textAlign: "left",
              }}
            >
              <div className="tok">
                <ImportIcon />
              </div>

              <div className="body">
                <div className="nm">{t("welcome.importWallet")}</div>
                <div className="sub">{t("welcome.importWalletSub")}</div>
              </div>

              <div className="num">
                <div className="q">›</div>
              </div>
            </button>

            <button
              type="button"
              className="row"
              onClick={onAddWatchWallet}
              style={{
                border: 0,
                background: "transparent",
                textAlign: "left",
              }}
            >
              <div className="tok">
                <WatchIcon />
              </div>

              <div className="body">
                <div className="nm">{t("welcome.watchAddress")}</div>
                <div className="sub">{t("welcome.watchAddressSub")}</div>
              </div>

              <div className="num">
                <div className="q">›</div>
              </div>
            </button>
          </div>
        </section>

        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--bg-surface)",
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
              background: "var(--secure-soft)",
              color: "var(--secure)",
            }}
          >
            <ShieldIcon />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 750,
                color: "var(--ink-1)",
              }}
            >
              {t("welcome.localFirstTitle")}
            </div>

            <div
              style={{
                marginTop: 4,
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {t("welcome.localFirstBody")}
            </div>
          </div>
        </section>
      </div>

      {prefsOpen ? (
        <PreferencesSheet onClose={() => setPrefsOpen(false)} />
      ) : null}
    </div>
  );
}

export default WelcomePage;
