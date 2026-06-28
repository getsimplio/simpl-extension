// src/popup/biometric-autoprompt.ts
//
// Transient, per-session signal that suppresses the one-shot automatic biometric
// prompt on the UnlockPage right after a *manual* lock. When the user themselves
// taps "Lock wallet", we must not immediately shove a Touch ID / Windows Hello
// system prompt back in their face — they just chose to lock.
//
// It lives in sessionStorage (never persisted to disk / chrome.storage), is set
// at the manual-lock call sites, and is consumed on the first UnlockPage render
// so it can only affect that single transition. A fresh extension open while
// already locked never sets it, so the auto-prompt still fires there.

const SUPPRESS_KEY = "simpl:suppressBiometricAutoPromptOnce";

// Mark that the next UnlockPage render must NOT auto-trigger the biometric prompt.
export function suppressBiometricAutoPromptOnce(): void {
  try {
    sessionStorage.setItem(SUPPRESS_KEY, "1");
  } catch {
    // Best effort: if sessionStorage is unavailable the auto-prompt simply runs.
  }
}

// Returns true if a suppression was pending, clearing it so it applies only once.
export function consumeBiometricAutoPromptSuppression(): boolean {
  try {
    if (sessionStorage.getItem(SUPPRESS_KEY)) {
      sessionStorage.removeItem(SUPPRESS_KEY);
      return true;
    }
  } catch {
    // Ignore — treat an unreadable flag as "not suppressed".
  }
  return false;
}
