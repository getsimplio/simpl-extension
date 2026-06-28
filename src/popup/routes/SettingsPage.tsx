// src/popup/routes/SettingsPage.tsx

import { useState, type ReactNode } from "react";
import type {
  DefaultOpenMode,
  LocalePreference,
  SupportedLocale,
  ThemePreference,
  WalletState,
} from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import { storageRepository } from "../../core/storage/storage.repository";
import { applyThemePreference } from "../../core/theme/theme";
import { SUPPORTED_LOCALES, useTranslation } from "../../i18n";
import { openFullscreenApp, openSidePanel } from "../surface-actions";
import { suppressBiometricAutoPromptOnce } from "../biometric-autoprompt";

import SecurityCenterPage from "./SecurityCenterPage";

type SettingsPageProps = {
  walletState: WalletState;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onRevealSeed: () => void;
  onRevealPrivateKey: () => void;
  // When true, open straight into Security Center with the Danger Zone focused
  // (used by the "Reset wallet data" action on a primary account).
  initialShowSecurityCenter?: boolean;
};

// Translation-key maps for the enum settings (matches the unions in
// storage.types). Labels are resolved through `t()` at render time.
const OPEN_MODE_LABEL_KEYS = {
  popup: "settings.openMode.popup",
  sidePanel: "settings.openMode.sidePanel",
  fullscreen: "settings.openMode.fullscreen",
} as const;

const OPEN_MODE_OPTIONS: DefaultOpenMode[] = ["popup", "sidePanel", "fullscreen"];

// Appearance / theme options shown in the Settings "Appearance" segmented
// control (matches the ThemePreference union in storage.types).
const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];

const THEME_LABEL_KEYS = {
  system: "settings.theme.system",
  light: "settings.theme.light",
  dark: "settings.theme.dark",
} as const;

// Native language names live under `language.<locale>` keys (identical across
// every dictionary so users always recognize their own language).
const LANGUAGE_LABEL_KEYS: Record<SupportedLocale, `language.${SupportedLocale}`> =
  {
    en: "language.en",
    ru: "language.ru",
    "es-419": "language.es-419",
    "pt-BR": "language.pt-BR",
    tr: "language.tr",
    uk: "language.uk",
    vi: "language.vi",
    id: "language.id",
  };

// Kept in sync with DEFAULT_OPEN_MODE_CHANGED_MESSAGE in the service worker.
// The popup notifies the background so it re-applies the toolbar open behavior
// immediately, without waiting for a browser restart.
const DEFAULT_OPEN_MODE_CHANGED_MESSAGE = "SIMPL_DEFAULT_OPEN_MODE_CHANGED";

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" />
      <path d="M14 5v14" fill="none" stroke="currentColor" />
    </svg>
  );
}

// Small check used to mark the selected "Open by default" chip.
function CheckIcon() {
  return (
    <svg
      className="disp-chip__check"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

// Compact popup window glyph for the "Default open mode" chips.
function PopupIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" />
      <path d="M5 9h14" fill="none" stroke="currentColor" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

// Glyphs for the Appearance chips: monitor (System), sun (Light), moon (Dark).
function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" />
      <path d="M9 21h6M12 17v4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" />
      <path
        d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === "light") return <SunIcon />;
  if (theme === "dark") return <MoonIcon />;
  return <MonitorIcon />;
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-2.8 8.5-7 10-4.2-1.5-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function PhraseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" />
      <path d="M7 9.5h6M7 13h8M7 16.5h4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" />
      <path d="M11 12l8-8M16 4l4 4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className="set-row__chev"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

type RowTone = "brand" | "neutral" | "secure" | "warn" | "danger";

// Clickable settings row: tinted icon + title/subtitle + right-side affordance.
// The whole row is the button so the hit area is the full width.
function ActionRow({
  icon,
  tone = "neutral",
  title,
  subtitle,
  aside,
  onClick,
}: {
  icon: ReactNode;
  tone?: RowTone;
  title: string;
  subtitle: string;
  aside?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="set-row"
      onClick={onClick}
      disabled={!onClick}
    >
      <span className={`set-row__icon set-row__icon--${tone}`}>{icon}</span>

      <span className="set-row__body">
        <span className="set-row__title">{title}</span>
        <span className="set-row__sub">{subtitle}</span>
      </span>

      <span className="set-row__aside">{aside ?? (onClick ? <Chevron /> : null)}</span>
    </button>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section__label">{label}</div>
      <div className="set-card">{children}</div>
    </section>
  );
}

export function SettingsPage({
  walletState,
  onBack,
  onChanged,
  onRevealSeed,
  onRevealPrivateKey,
  initialShowSecurityCenter = false,
}: SettingsPageProps) {
  const { t, locale, setLocale } = useTranslation();
  const [showSecurityCenter, setShowSecurityCenter] = useState(
    initialShowSecurityCenter,
  );

  const [openingBehaviorOpen, setOpeningBehaviorOpen] = useState(false);
  const [languageSelectorOpen, setLanguageSelectorOpen] = useState(false);
  const [appearanceSelectorOpen, setAppearanceSelectorOpen] = useState(false);

  const defaultOpenMode = walletState.settings.defaultOpenMode;
  const currentTheme = walletState.settings.theme;

  async function handleChanged() {
    await onChanged();
  }

  // Persist the chosen default open mode, then ping the service worker so it
  // re-applies the toolbar-icon behavior right away. "fullscreen" keeps the
  // action pointed at the popup (Chrome can't target a tab); the popup itself
  // hands off to a full-page tab on open (see popup/main.tsx).
  async function selectOpenMode(mode: DefaultOpenMode) {
    if (mode !== defaultOpenMode) {
      await storageRepository.updateSettings({ defaultOpenMode: mode });
      try {
        chrome.runtime?.sendMessage?.({
          type: DEFAULT_OPEN_MODE_CHANGED_MESSAGE,
        });
      } catch {
        // Best-effort: the background also re-reads the setting on next startup.
      }
      await handleChanged();
    }
  }

  // Persist the chosen appearance and apply it to the document immediately so the
  // change is visible without waiting for the next open.
  async function selectTheme(theme: ThemePreference) {
    if (theme === currentTheme) return;
    applyThemePreference(theme);
    await storageRepository.updateSettings({ theme });
    await handleChanged();
  }

  // From the appearance selector subpage: apply the theme, then return to
  // Settings so the compact row reflects the new choice.
  async function handleSelectTheme(theme: ThemePreference) {
    await selectTheme(theme);
    setAppearanceSelectorOpen(false);
  }

  // Persist the chosen interface language and apply it live. setLocale() updates
  // the in-memory store + mirror so every subscribed component re-renders
  // immediately; updateSettings() makes it the authoritative preference. We
  // store the concrete locale (not "auto") since this is an explicit choice.
  async function selectLocale(next: SupportedLocale) {
    if (next === locale) return;
    const preference: LocalePreference = next;
    setLocale(preference);
    await storageRepository.updateSettings({ locale: preference });
    await handleChanged();
  }

  // From the language selector subpage: apply the choice, then return to
  // Settings so the updated language is reflected in the compact row.
  async function handleSelectLocale(next: SupportedLocale) {
    await selectLocale(next);
    setLanguageSelectorOpen(false);
  }

  async function lockWallet() {
    // User-initiated lock: don't auto-prompt biometrics on the unlock screen we
    // are about to show. The button stays available for an explicit tap.
    suppressBiometricAutoPromptOnce();
    walletService.lockWallet();
    await handleChanged();
  }

  // Destructive wallet removal. The Danger Zone UI + confirmation now live in
  // Security Center; this owns the actual deletion (wallet clear + state
  // refresh) because walletState lives here.
  async function clearWalletNow() {
    await walletService.clearWallet();

    await handleChanged();
  }

  // Opening behavior — a local subpage (same pattern as the network selector):
  // pick the default launch mode and quick-open the side panel / full screen.
  if (openingBehaviorOpen) {
    return (
      <div className="ext-popup settings-page" data-screen-label="Opening behavior">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={() => setOpeningBehaviorOpen(false)}
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>

          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            {t("settings.openingBehaviorTitle")}
          </div>

          <span style={{ flex: 1 }} />
        </div>

        <div className="screen-body settings-body">
          <header className="set-hero">
            <div className="set-hero__title">
              {t("settings.openingBehaviorTitle")}
            </div>
            <div className="set-hero__sub">
              {t("settings.openingBehaviorDesc")}
            </div>
          </header>

          <div className="set-grid">
            <Section label={t("settings.openByDefault")}>
              <div className="set-display__pad">
                <div className="set-display__hint">
                  {t("settings.openByDefaultHint")}
                </div>
                <div className="set-display__chips">
                  {OPEN_MODE_OPTIONS.map((mode) => {
                    const on = defaultOpenMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`disp-chip${on ? " disp-chip--on" : ""}`}
                        aria-pressed={on}
                        onClick={() => void selectOpenMode(mode)}
                      >
                        {mode === "sidePanel" ? (
                          <PanelIcon />
                        ) : mode === "fullscreen" ? (
                          <ExpandIcon />
                        ) : (
                          <PopupIcon />
                        )}
                        <span className="disp-chip__label">
                          {t(OPEN_MODE_LABEL_KEYS[mode])}
                        </span>
                        {on ? <CheckIcon /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            <Section label={t("settings.openNow")}>
              <div className="set-display__pad">
                <div className="set-display__chips">
                  <button
                    type="button"
                    className="disp-chip disp-chip--action"
                    onClick={() => void openSidePanel()}
                  >
                    <PanelIcon />
                    <span className="disp-chip__label">
                      {t("settings.openMode.sidePanel")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="disp-chip disp-chip--action"
                    onClick={openFullscreenApp}
                  >
                    <ExpandIcon />
                    <span className="disp-chip__label">
                      {t("settings.openMode.fullscreen")}
                    </span>
                  </button>
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    );
  }

  // Language selector — a local subpage (same full-screen pattern as the network
  // selector and Opening behavior). Picking a language applies it live and
  // returns to Settings, where the compact row reflects the new choice.
  if (languageSelectorOpen) {
    return (
      <div className="ext-popup settings-page" data-screen-label="Language">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={() => setLanguageSelectorOpen(false)}
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>

          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            {t("settings.language.selectorTitle")}
          </div>

          <span style={{ flex: 1 }} />
        </div>

        <div className="screen-body settings-body">
          <header className="set-hero">
            <div className="set-hero__title">
              {t("settings.language.selectorTitle")}
            </div>
            <div className="set-hero__sub">
              {t("settings.language.selectorSubtitle")}
            </div>
          </header>

          <div className="set-grid">
            <Section label={t("settings.section.language")}>
              <div className="set-display__pad">
                <div className="set-lang-list">
                  {SUPPORTED_LOCALES.map((option) => {
                    const on = locale === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`set-lang-row${on ? " set-lang-row--on" : ""}`}
                        aria-pressed={on}
                        lang={option}
                        onClick={() => void handleSelectLocale(option)}
                      >
                        <span className="set-lang-row__name">
                          {t(LANGUAGE_LABEL_KEYS[option])}
                        </span>
                        {on ? <CheckIcon /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    );
  }

  // Appearance selector — same full-screen subpage pattern as Language. Picking a
  // theme applies it live and returns to Settings, where the compact row shows
  // the new value. The selected option uses the simpl black/white active state.
  if (appearanceSelectorOpen) {
    return (
      <div className="ext-popup settings-page" data-screen-label="Appearance">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={() => setAppearanceSelectorOpen(false)}
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>

          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
            {t("settings.appearance.selectorTitle")}
          </div>

          <span style={{ flex: 1 }} />
        </div>

        <div className="screen-body settings-body">
          <header className="set-hero">
            <div className="set-hero__title">
              {t("settings.appearance.selectorTitle")}
            </div>
            <div className="set-hero__sub">
              {t("settings.appearance.selectorSubtitle")}
            </div>
          </header>

          <div className="set-grid">
            <Section label={t("settings.section.appearance")}>
              <div className="set-display__pad">
                <div className="set-lang-list">
                  {THEME_OPTIONS.map((theme) => {
                    const on = currentTheme === theme;
                    return (
                      <button
                        key={theme}
                        type="button"
                        className={`set-lang-row${on ? " set-lang-row--on" : ""}`}
                        aria-pressed={on}
                        onClick={() => void handleSelectTheme(theme)}
                      >
                        <span className="set-lang-row__lead">
                          <ThemeIcon theme={theme} />
                          <span className="set-lang-row__name">
                            {t(THEME_LABEL_KEYS[theme])}
                          </span>
                        </span>
                        {on ? <CheckIcon /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    );
  }

  if (showSecurityCenter) {
    return (
      <SecurityCenterPage
        focusDanger={initialShowSecurityCenter}
        onBack={() => {
          setShowSecurityCenter(false);
          void handleChanged();
        }}
        onClearWallet={clearWalletNow}
        walletState={walletState}
        onChanged={handleChanged}
        initialSnapshot={{
          settings: walletState.settings,
          biometricUnlock: walletState.settings.biometricUnlock,
          selectedChainId: walletState.selectedChainId,
        }}
      />
    );
  }

  return (
    <div className="ext-popup settings-page" data-screen-label="08 Settings">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>

          <div
            style={{
              fontSize: 13,
              fontWeight: 650,
              color: "var(--ink-1)",
            }}
          >
            {t("settings.title")}
          </div>

          <span style={{ flex: 1 }} />

          {/* Compact language + theme selectors — same chip styling, opening the
              existing Language / Appearance selector subpages. */}
          <div className="set-head-chips">
            <button
              className="net-chip"
              type="button"
              onClick={() => setLanguageSelectorOpen(true)}
              title={t(LANGUAGE_LABEL_KEYS[locale])}
              aria-label={t("settings.changeLanguage")}
            >
              <span className="net-chip-label" lang={locale}>
                {locale.split("-")[0].toUpperCase()}
              </span>
            </button>

            <button
              className="net-chip net-chip--icon"
              type="button"
              onClick={() => setAppearanceSelectorOpen(true)}
              title={t(THEME_LABEL_KEYS[currentTheme])}
              aria-label={t("settings.changeAppearance")}
            >
              <span className="net-chip-glyph">
                <ThemeIcon theme={currentTheme} />
              </span>
            </button>
          </div>
        </div>

        <div className="screen-body settings-body">
          <header className="set-hero">
            <div className="set-hero__title">{t("settings.heroTitle")}</div>
            <div className="set-hero__sub">{t("settings.heroSub")}</div>
          </header>

          <div className="set-grid">
            {/* APP — launch mode and display preferences. */}
            <Section label={t("settings.section.app")}>
              <ActionRow
                icon={
                  defaultOpenMode === "sidePanel" ? (
                    <PanelIcon />
                  ) : defaultOpenMode === "fullscreen" ? (
                    <ExpandIcon />
                  ) : (
                    <PopupIcon />
                  )
                }
                tone="neutral"
                title={t("settings.appBehavior")}
                subtitle={t("settings.appBehaviorSub")}
                aside={
                  <>
                    <span className="set-row__value">
                      {t(OPEN_MODE_LABEL_KEYS[defaultOpenMode])}
                    </span>
                    <Chevron />
                  </>
                }
                onClick={() => setOpeningBehaviorOpen(true)}
              />
            </Section>

            {/* SECURITY */}
            <Section label={t("settings.section.security")}>
              <ActionRow
                icon={<ShieldIcon />}
                tone="secure"
                title={t("settings.securityCenter")}
                subtitle={t("settings.securityCenterSub")}
                onClick={() => setShowSecurityCenter(true)}
              />
            </Section>

            {/* BACKUP & KEYS — sensitive reveal actions, kept calm (muted amber)
                and lower on the screen than everyday preferences. */}
            <Section label={t("settings.section.backupKeys")}>
              <ActionRow
                icon={<PhraseIcon />}
                tone="warn"
                title={t("settings.revealSeed")}
                subtitle={t("settings.revealSeedSub")}
                onClick={onRevealSeed}
              />

              <ActionRow
                icon={<KeyIcon />}
                tone="warn"
                title={t("settings.revealPrivateKey")}
                subtitle={t("settings.revealPrivateKeySub")}
                onClick={onRevealPrivateKey}
              />
            </Section>

            {/* SESSION */}
            <Section label={t("settings.section.session")}>
              <ActionRow
                icon={<LockIcon />}
                tone="neutral"
                title={t("settings.lockWallet")}
                subtitle={t("settings.lockWalletSub")}
                onClick={() => void lockWallet()}
              />
            </Section>
          </div>
        </div>
      </div>
  );
}

export default SettingsPage;
