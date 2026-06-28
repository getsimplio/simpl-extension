// src/core/security/biometric-debug.ts
//
// Dev-safe, non-sensitive tracing for the biometric unlock flow. Uses
// console.debug (filtered out of the browser console's default view) so it is
// safe to ship, and can be muted entirely by setting
// localStorage["simpl.debug.biometric"] = "0".
//
// SECURITY: never pass the password, seed, private key, decrypted secret, PRF
// output, or the full wrappedSecret to this function. Log presence booleans and
// error names only.

export function biometricDebug(
  event: string,
  data?: Record<string, unknown>,
): void {
  try {
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("simpl.debug.biometric") === "0"
    ) {
      return;
    }
    console.debug(`[biometric] ${event}`, data ?? {});
  } catch {
    // Logging must never break the unlock flow.
  }
}
