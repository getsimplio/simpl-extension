// scripts/check-i18n.ts
//
// Verifies every locale dictionary has exactly the same set of keys as English
// (the source of truth). TypeScript already enforces this at build time via
// `Record<TranslationKey, string>`, but this script gives a fast, readable
// report of any missing/extra keys per locale — handy when adding a new language.
//
// Run: npm run check:i18n

import { en } from "../src/i18n/locales/en";
import { ru } from "../src/i18n/locales/ru";
import { es419 } from "../src/i18n/locales/es-419";
import { ptBR } from "../src/i18n/locales/pt-BR";
import { tr } from "../src/i18n/locales/tr";
import { uk } from "../src/i18n/locales/uk";
import { vi } from "../src/i18n/locales/vi";
import { id } from "../src/i18n/locales/id";

const LOCALES: Record<string, Record<string, string>> = {
  ru,
  "es-419": es419,
  "pt-BR": ptBR,
  tr,
  uk,
  vi,
  id,
};

console.log("START I18N KEY CHECK");
console.log("");

const enKeys = Object.keys(en);
console.log(`Source locale: en (${enKeys.length} keys)`);
console.log("");

let hasProblem = false;

for (const [code, dict] of Object.entries(LOCALES)) {
  const keys = new Set(Object.keys(dict));
  const missing = enKeys.filter((key) => !keys.has(key));
  const extra = Object.keys(dict).filter(
    (key) => !(key in (en as Record<string, string>)),
  );
  const blank = enKeys.filter((key) => keys.has(key) && dict[key].trim() === "");

  if (missing.length === 0 && extra.length === 0 && blank.length === 0) {
    console.log(`✓ ${code}: complete (${Object.keys(dict).length} keys)`);
    continue;
  }

  hasProblem = true;
  console.log(`✗ ${code}:`);
  if (missing.length) console.log(`   missing (${missing.length}): ${missing.join(", ")}`);
  if (extra.length) console.log(`   extra (${extra.length}): ${extra.join(", ")}`);
  if (blank.length) console.log(`   blank (${blank.length}): ${blank.join(", ")}`);
}

console.log("");

if (hasProblem) {
  console.log("I18N KEY CHECK FAILED");
  process.exit(1);
}

console.log("I18N KEY CHECK PASSED");
