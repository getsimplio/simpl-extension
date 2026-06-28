// src/core/theme/theme.ts
//
// Appearance / dark-theme application. The authoritative preference lives in the
// wallet settings (chrome.storage, async), but we also keep a synchronous
// localStorage mirror so the very first paint of a popup/sidepanel can pick the
// right theme WITHOUT a flash of the light theme. The flow is:
//
//   1. Each entrypoint calls `initThemeEarly()` before React renders. This reads
//      the synchronous mirror and sets `data-theme` immediately.
//   2. Once the wallet state loads, App calls `applyThemePreference(settings.theme)`
//      which re-syncs the mirror with the authoritative value and re-applies.
//
// The theme is expressed as `data-theme="light" | "dark"` on <html>, matching the
// palette blocks in design-system/colors_and_type.css and the override block in
// ui/claude/styles/runtime-overrides.css.

import type { ThemePreference } from "../storage/storage.types";

export type ResolvedTheme = "light" | "dark";

// Dot-namespaced (app-level) preference key. Intentionally NOT under the
// `simple:` prefix so it survives a wallet reset, consistent with other app
// preferences like `simple.actionMode`.
const THEME_MIRROR_KEY = "simple.theme";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

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

function prefersDark(): boolean {
  try {
    return globalThis.matchMedia?.(DARK_MEDIA_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

// Read the synchronous mirror written by `applyThemePreference`. Defaults to
// "system" when nothing has been stored yet (fresh install / onboarding).
export function readStoredThemePreference(): ThemePreference {
  const raw = getLocalStorage()?.getItem(THEME_MIRROR_KEY);

  return isThemePreference(raw) ? raw : "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return prefersDark() ? "dark" : "light";
  }

  return preference;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  getDocumentRoot()?.setAttribute("data-theme", resolved);
}

// Persist the preference to the synchronous mirror and apply it to the document
// right away. Call this whenever the user changes the setting or when the
// authoritative wallet state loads.
export function applyThemePreference(preference: ThemePreference): void {
  try {
    getLocalStorage()?.setItem(THEME_MIRROR_KEY, preference);
  } catch {
    // Best-effort: a missing mirror only costs a one-frame flash next open.
  }

  applyResolvedTheme(resolveTheme(preference));
}

let systemThemeListenerBound = false;

// Re-apply the resolved theme when the OS color scheme changes, but only while
// the stored preference is "system". Idempotent — safe to call from every
// entrypoint; the listener is bound at most once per document.
function watchSystemTheme(): void {
  if (systemThemeListenerBound) return;

  try {
    const mediaQuery = globalThis.matchMedia?.(DARK_MEDIA_QUERY);
    if (!mediaQuery) return;

    mediaQuery.addEventListener("change", () => {
      if (readStoredThemePreference() === "system") {
        applyResolvedTheme(resolveTheme("system"));
      }
    });

    systemThemeListenerBound = true;
  } catch {
    // matchMedia unavailable (e.g. non-DOM context) — nothing to watch.
  }
}

// Synchronous early application from the localStorage mirror. Call this before
// React renders so the first paint already has the correct theme. Also binds the
// OS-theme watcher for the "system" preference.
export function initThemeEarly(): void {
  applyResolvedTheme(resolveTheme(readStoredThemePreference()));
  watchSystemTheme();
}
