// src/popup/surface.ts
//
// Single source of truth for "which surface am I rendering in" — popup,
// fullscreen tab, or side panel. The surface is marked on <html> at each entry
// point (sidepanel/main.tsx → "sidepanel", popup/main.tsx → "fullscreen" when
// launched with ?surface=fullscreen; the plain popup sets nothing). Read-only:
// surface is never written to persistent storage.

export type AppSurface = "popup" | "fullscreen" | "sidepanel" | "unknown";

export function getCurrentSurface(): AppSurface {
  if (typeof document === "undefined") return "unknown";

  const attr = document.documentElement.dataset.simpleSurface;
  if (attr === "sidepanel") return "sidepanel";
  if (attr === "fullscreen") return "fullscreen";
  if (attr === "popup") return "popup";

  // The fullscreen entry sets the attribute, but fall back to the query param it
  // is derived from in case this runs before the attribute is applied.
  try {
    if (
      new URLSearchParams(window.location.search).get("surface") === "fullscreen"
    ) {
      return "fullscreen";
    }
  } catch {
    // window/search unavailable — fall through to the popup default.
  }

  // The plain toolbar popup is the only entry point that marks nothing.
  return "popup";
}
