// src/i18n/index.ts
//
// Lightweight, dependency-free i18n layer for the wallet UI. It mirrors the
// appearance/theme design (see core/theme/theme.ts):
//
//   1. The authoritative language preference lives in wallet settings
//      (chrome.storage, async). A synchronous localStorage mirror lets the very
//      first paint pick the right language without a flash of English.
//   2. Each entrypoint calls `initLocaleEarly()` before React renders.
//   3. Once wallet state loads, App calls `applyLocalePreference(settings.locale)`
//      to re-sync the mirror with the authoritative value.
//
// Reactivity is provided through `useTranslation()`, backed by an external store,
// so changing the language re-renders every subscribed component immediately —
// no extension reload required.

import { useSyncExternalStore } from "react";
import type {
  LocalePreference,
  SupportedLocale,
  TranslationKey,
  TranslationParams,
  TranslationDictionary,
} from "./types";
import { INTL_LOCALE_TAG, SUPPORTED_LOCALES } from "./types";

import { en } from "./locales/en";
import { ru } from "./locales/ru";
import { es419 } from "./locales/es-419";
import { ptBR } from "./locales/pt-BR";
import { tr } from "./locales/tr";
import { uk } from "./locales/uk";
import { vi } from "./locales/vi";
import { id } from "./locales/id";

export type { SupportedLocale, LocalePreference, TranslationKey } from "./types";
export { SUPPORTED_LOCALES } from "./types";

// English is the fallback for any key a locale is missing at runtime (the type
// system already prevents this for shipped locales, but third-party builds or
// partial hot edits should still never render a blank string).
const DICTIONARIES: Record<SupportedLocale, TranslationDictionary> = {
  en,
  ru,
  "es-419": es419,
  "pt-BR": ptBR,
  tr,
  uk,
  vi,
  id,
};

const FALLBACK_LOCALE: SupportedLocale = "en";

// Dot-namespaced (app-level) preference key, intentionally NOT under the
// `simple:` prefix so it survives a wallet reset — consistent with the theme
// mirror (`simple.theme`).
const LOCALE_MIRROR_KEY = "simple.locale";

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function getDocumentRoot(): HTMLElement | null {
  try {
    return globalThis.document?.documentElement ?? null;
  } catch {
    return null;
  }
}

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || isSupportedLocale(value);
}

// Best-effort detection of the user's browser language, mapped onto a supported
// locale. Matches exact tags first (e.g. "pt-BR"), then the base language (e.g.
// "pt" → "pt-BR", "es" → "es-419"). Returns null when nothing matches.
function detectBrowserLocale(): SupportedLocale | null {
  let candidates: readonly string[] = [];
  try {
    const nav = globalThis.navigator;
    candidates = nav?.languages?.length
      ? nav.languages
      : nav?.language
        ? [nav.language]
        : [];
  } catch {
    candidates = [];
  }

  for (const raw of candidates) {
    const tag = raw.toLowerCase();

    // Exact supported-tag match.
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;

    // Base-language match.
    const base = tag.split("-")[0];
    if (base === "en") return "en";
    if (base === "ru") return "ru";
    if (base === "es") return "es-419";
    if (base === "pt") return "pt-BR";
    if (base === "tr") return "tr";
    if (base === "uk") return "uk";
    if (base === "vi") return "vi";
    if (base === "id") return "id";
  }

  return null;
}

// Resolve a stored preference to a concrete locale. "auto" follows the browser,
// falling back to English when the browser language is unsupported.
export function resolveLocale(preference: LocalePreference): SupportedLocale {
  if (preference === "auto") {
    return detectBrowserLocale() ?? FALLBACK_LOCALE;
  }
  return preference;
}

export function readStoredLocalePreference(): LocalePreference {
  const raw = getLocalStorage()?.getItem(LOCALE_MIRROR_KEY);
  return isLocalePreference(raw) ? raw : "auto";
}

// ── External store (for useSyncExternalStore reactivity) ───────────────────

let currentPreference: LocalePreference = "auto";
let currentLocale: SupportedLocale = FALLBACK_LOCALE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SupportedLocale {
  return currentLocale;
}

function setDocumentLang(locale: SupportedLocale): void {
  getDocumentRoot()?.setAttribute("lang", locale);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getActiveLocale(): SupportedLocale {
  return currentLocale;
}

export function getLocalePreference(): LocalePreference {
  return currentPreference;
}

// Interpolate {placeholder} tokens with the supplied params.
function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

// Translate a key for the active locale, falling back to English (and finally to
// the key itself) so the UI never renders a blank string.
export function t(key: TranslationKey, params?: TranslationParams): string {
  const dict = DICTIONARIES[currentLocale] ?? DICTIONARIES[FALLBACK_LOCALE];
  const template = dict[key] ?? DICTIONARIES[FALLBACK_LOCALE][key] ?? key;
  return interpolate(template, params);
}

// Translate using an explicit locale (for non-reactive / background contexts).
export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[FALLBACK_LOCALE];
  const template = dict[key] ?? DICTIONARIES[FALLBACK_LOCALE][key] ?? key;
  return interpolate(template, params);
}

// Persist the preference to the synchronous mirror, recompute the resolved
// locale, apply it to the document, and notify subscribers. Call this whenever
// the user changes the setting or when authoritative wallet state loads.
export function applyLocalePreference(preference: LocalePreference): void {
  currentPreference = preference;
  currentLocale = resolveLocale(preference);

  try {
    getLocalStorage()?.setItem(LOCALE_MIRROR_KEY, preference);
  } catch {
    // Best-effort: a missing mirror only costs a one-frame flash next open.
  }

  setDocumentLang(currentLocale);
  emit();
}

// Synchronous early application from the localStorage mirror. Call before React
// renders so the first paint already uses the correct language.
export function initLocaleEarly(): void {
  currentPreference = readStoredLocalePreference();
  currentLocale = resolveLocale(currentPreference);
  setDocumentLang(currentLocale);
}

// ── React binding ──────────────────────────────────────────────────────────

export type UseTranslation = {
  t: (key: TranslationKey, params?: TranslationParams) => string;
  locale: SupportedLocale;
  setLocale: (preference: LocalePreference) => void;
};

// Subscribe a component to language changes. `t` is stable to call during render
// and always reflects the active locale; `setLocale` only updates the in-memory
// store + mirror — callers that need persistence should also write the wallet
// settings (see SettingsPage).
export function useTranslation(): UseTranslation {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    t,
    locale,
    setLocale: applyLocalePreference,
  };
}

// ── Formatting helpers (locale-aware via Intl) ─────────────────────────────

function intlTag(locale: SupportedLocale = currentLocale): string {
  return INTL_LOCALE_TAG[locale] ?? "en-US";
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(intlTag(), options).format(value);
  } catch {
    return String(value);
  }
}

export function formatCurrency(
  value: number,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(intlTag(), {
      style: "currency",
      currency,
      ...options,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export function formatPercent(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(intlTag(), {
      style: "percent",
      maximumFractionDigits: 2,
      ...options,
    }).format(value);
  } catch {
    return `${value}%`;
  }
}
