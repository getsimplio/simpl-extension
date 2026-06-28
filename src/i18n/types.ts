// src/i18n/types.ts
//
// Type plumbing for the i18n layer. English (`en`) is the source of truth: its
// keys define `TranslationKey`, and every other locale is typed as a complete
// `TranslationDictionary`, so a missing or misspelled key in any language is a
// compile-time error (`npm run typecheck`).

import type { en } from "./locales/en";
import type { SupportedLocale } from "../core/storage/storage.types";

export type { SupportedLocale } from "../core/storage/storage.types";
export type { LocalePreference } from "../core/storage/storage.types";

// Every translatable string key, derived from the English dictionary.
export type TranslationKey = keyof typeof en;

// Shape every locale must satisfy. Using a mapped type (rather than
// `typeof en`) keeps the value type as plain `string`, so translations are not
// pinned to the exact English literal.
export type TranslationDictionary = Record<TranslationKey, string>;

// Values accepted for {placeholder} interpolation.
export type TranslationParams = Record<string, string | number>;

// The ordered list of languages offered in Settings.
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  "en",
  "ru",
  "es-419",
  "pt-BR",
  "tr",
  "uk",
  "vi",
  "id",
] as const;

// Maps each supported locale to a BCP-47 tag usable by the Intl APIs.
export const INTL_LOCALE_TAG: Record<SupportedLocale, string> = {
  en: "en-US",
  ru: "ru-RU",
  "es-419": "es-419",
  "pt-BR": "pt-BR",
  tr: "tr-TR",
  uk: "uk-UA",
  vi: "vi-VN",
  id: "id-ID",
};
