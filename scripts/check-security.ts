// scripts/check-security.ts

import {
  assertValidPassword,
  validatePassword,
} from "../src/core/security/password-policy";

import { AutoLockService } from "../src/core/security/auto-lock.service";
import { biometricUnlockService } from "../src/core/security/biometric-unlock.service";

console.log("START SECURITY CHECK");
console.log("");

console.log("CHECK 1 — weak password should be invalid:");
const weakPassword = validatePassword("12345678");
console.log({
  valid: weakPassword.valid,
  errors: weakPassword.errors,
});
console.log("");

console.log("CHECK 2 — strong password should be valid:");
const strongPassword = validatePassword("strong-test-password-123");
console.log({
  valid: strongPassword.valid,
  errors: strongPassword.errors,
});
console.log("");

console.log("CHECK 3 — assertValidPassword should pass:");
try {
  assertValidPassword("strong-test-password-123");
  console.log("Passed as expected");
} catch {
  console.log("Unexpected failure");
}
console.log("");

console.log("CHECK 4 — assertValidPassword should fail:");
try {
  assertValidPassword("12345678");
  console.log("Unexpected success");
} catch {
  console.log("Failed as expected");
}
console.log("");

console.log("CHECK 5 — auto-lock should not lock immediately:");
const autoLock = new AutoLockService();

const now = Date.now();
autoLock.unlock(now);

const shouldLockImmediately = autoLock.shouldAutoLock(
  { autoLockMinutes: 15 },
  now + 1_000
);

console.log({
  shouldLockImmediately,
});
console.log("");

console.log("CHECK 6 — auto-lock should lock after timeout:");
const shouldLockAfterTimeout = autoLock.shouldAutoLock(
  { autoLockMinutes: 15 },
  now + 16 * 60_000
);

console.log({
  shouldLockAfterTimeout,
});
console.log("");

console.log("CHECK 7 — remaining time should be calculated:");
autoLock.unlock(now);

const remainingMs = autoLock.getRemainingMs(
  { autoLockMinutes: 15 },
  now + 5 * 60_000
);

console.log({
  remainingMs,
  remainingMinutes: remainingMs === null ? null : remainingMs / 60_000,
});
console.log("");

console.log("CHECK 8 — manual lock:");
autoLock.lock(now + 1_000);

console.log(autoLock.getState({ autoLockMinutes: 15 }));
console.log("");

console.log("CHECK 9 — biometric availability in current environment:");
const biometricAvailable = await biometricUnlockService.isAvailable();

console.log({
  biometricAvailable,
  note:
    "In Node.js this is expected to be false. In Chrome extension it may be true if Touch ID / platform authenticator is available.",
});
console.log("");

console.log("SECURITY CHECK FINISHED");