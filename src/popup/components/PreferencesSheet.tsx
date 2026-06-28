// Compact onboarding Preferences sheet: Language, Theme and Open mode as
// vertical option lists (no wide segmented controls, so every row fits a 360px
// popup). Anchors to .ext-popup like the other sheets, so it overlays correctly
// in popup, side panel and fullscreen. Closes via the close button, the
// backdrop, or Escape.
//
// It writes to the same settings store Settings uses — no second mechanism:
//   • Language  -> setLocale() (live) + updateSettings({ locale })
//   • Theme     -> applyThemePreference() (live) + updateSettings({ theme })
//   • Open mode -> updateSettings({ defaultOpenMode }) + notify the worker
// "popup" stays the safe default, so the user can always return to it.

import { useEffect, useState } from "react";

import { SUPPORTED_LOCALES, useTranslation } from "../../i18n";
import type { SupportedLocale, TranslationKey } from "../../i18n";
import { applyThemePreference } from "../../core/theme/theme";
import { storageRepository } from "../../core/storage/storage.repository";
import type {
  DefaultOpenMode,
  ThemePreference,
} from "../../core/storage/storage.types";

// Kept in sync with DEFAULT_OPEN_MODE_CHANGED_MESSAGE in the service worker
// (also duplicated as a literal in SettingsPage for the same reason).
const DEFAULT_OPEN_MODE_CHANGED_MESSAGE = "SIMPL_DEFAULT_OPEN_MODE_CHANGED";

const THEME_OPTIONS: { value: ThemePreference; labelKey: TranslationKey }[] = [
  { value: "system", labelKey: "settings.theme.system" },
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
];

const OPEN_MODE_OPTIONS: { value: DefaultOpenMode; labelKey: TranslationKey }[] =
  [
    { value: "popup", labelKey: "settings.openMode.popup" },
    { value: "sidePanel", labelKey: "settings.openMode.sidePanel" },
    { value: "fullscreen", labelKey: "settings.openMode.fullscreen" },
  ];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

type OptionRowProps = {
  label: string;
  selected: boolean;
  onSelect: () => void;
};

function OptionRow({ label, selected, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      className={`prefs-row${selected ? " prefs-row--on" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="prefs-row__label">{label}</span>
      {selected ? (
        <span className="prefs-row__check" aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
    </button>
  );
}

export function PreferencesSheet({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [openMode, setOpenMode] = useState<DefaultOpenMode>("popup");

  // Seed the local Theme / Open mode state from storage. Language reads from the
  // live i18n `locale`, so it needs no seeding here.
  useEffect(() => {
    let active = true;
    void storageRepository
      .getWalletState()
      .then((state) => {
        if (!active) return;
        setTheme(state.settings.theme);
        setOpenMode(state.settings.defaultOpenMode);
      })
      .catch(() => {
        // Keep safe defaults if settings can't be read yet.
      });
    return () => {
      active = false;
    };
  }, []);

  // Close on Escape, matching the rest of the app's overlays.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function selectLanguage(next: SupportedLocale) {
    if (next === locale) return;
    setLocale(next);
    try {
      await storageRepository.updateSettings({ locale: next });
    } catch {
      // Live change already applied; persistence is best-effort.
    }
  }

  async function selectTheme(next: ThemePreference) {
    if (next === theme) return;
    applyThemePreference(next);
    setTheme(next);
    try {
      await storageRepository.updateSettings({ theme: next });
    } catch {
      // Live change already applied; persistence is best-effort.
    }
  }

  async function selectOpenMode(next: DefaultOpenMode) {
    if (next === openMode) return;
    setOpenMode(next);
    try {
      await storageRepository.updateSettings({ defaultOpenMode: next });
      chrome.runtime?.sendMessage?.({ type: DEFAULT_OPEN_MODE_CHANGED_MESSAGE });
    } catch {
      // The worker also re-reads the setting on next startup.
    }
  }

  return (
    <div className="prefs-sheet-backdrop">
      <button
        type="button"
        className="prefs-sheet-scrim"
        aria-label={t("common.close")}
        onClick={onClose}
      />

      <section
        className="prefs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("welcome.preferences")}
      >
        <div className="prefs-sheet-head">
          <div className="prefs-sheet-title">{t("welcome.preferences")}</div>
          <button
            type="button"
            className="icbtn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="prefs-group">
          <div className="prefs-group__label">{t("settings.section.language")}</div>
          <div className="prefs-list">
            {SUPPORTED_LOCALES.map((option) => (
              <OptionRow
                key={option}
                label={t(`language.${option}` as TranslationKey)}
                selected={locale === option}
                onSelect={() => void selectLanguage(option)}
              />
            ))}
          </div>
        </div>

        <div className="prefs-group">
          <div className="prefs-group__label">{t("welcome.prefsTheme")}</div>
          <div className="prefs-list">
            {THEME_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                label={t(option.labelKey)}
                selected={theme === option.value}
                onSelect={() => void selectTheme(option.value)}
              />
            ))}
          </div>
        </div>

        <div className="prefs-group">
          <div className="prefs-group__label">{t("welcome.prefsOpenAs")}</div>
          <div className="prefs-list">
            {OPEN_MODE_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                label={t(option.labelKey)}
                selected={openMode === option.value}
                onSelect={() => void selectOpenMode(option.value)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default PreferencesSheet;
