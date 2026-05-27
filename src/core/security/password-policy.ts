// src/core/security/password-policy.ts

export type PasswordValidationErrorCode =
  | "PASSWORD_REQUIRED"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_MISSING_LETTER"
  | "PASSWORD_MISSING_NUMBER"
  | "PASSWORD_IS_TOO_COMMON";

export type PasswordPolicyConfig = {
  minLength: number;
  maxLength: number;
  requireLetter: boolean;
  requireNumber: boolean;

  /**
   * Kept for backward compatibility.
   * We do not block common passwords in the current local wallet flow.
   */
  blockedPasswords: string[];
};

export type PasswordValidationError = {
  code: PasswordValidationErrorCode;
  message: string;
};

export type PasswordValidationResult = {
  valid: boolean;
  errors: PasswordValidationError[];
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: 8,
  maxLength: 128,
  requireLetter: true,
  requireNumber: true,
  blockedPasswords: [],
};

export function validatePassword(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): PasswordValidationResult {
  const errors: PasswordValidationError[] = [];
  const normalizedPassword = password.trim();

  if (!normalizedPassword) {
    errors.push({
      code: "PASSWORD_REQUIRED",
      message: "Password is required.",
    });

    return {
      valid: false,
      errors,
    };
  }

  if (normalizedPassword.length < policy.minLength) {
    errors.push({
      code: "PASSWORD_TOO_SHORT",
      message: `Password must contain at least ${policy.minLength} characters.`,
    });
  }

  if (normalizedPassword.length > policy.maxLength) {
    errors.push({
      code: "PASSWORD_TOO_LONG",
      message: `Password must contain no more than ${policy.maxLength} characters.`,
    });
  }

  if (policy.requireLetter && !/[a-zA-Z]/.test(normalizedPassword)) {
    errors.push({
      code: "PASSWORD_MISSING_LETTER",
      message: "Password must contain at least one letter.",
    });
  }

  if (policy.requireNumber && !/\d/.test(normalizedPassword)) {
    errors.push({
      code: "PASSWORD_MISSING_NUMBER",
      message: "Password must contain at least one number.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidPassword(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): void {
  const result = validatePassword(password, policy);

  if (!result.valid) {
    throw new Error(result.errors[0]?.message ?? "Invalid password.");
  }
}