// src/core/security/biometric-unlock.service.ts
//
// Secure, browser-native biometric unlock built on WebAuthn + the PRF extension.
// No native host, no raw secret in storage — the platform authenticator
// (Touch ID / Windows Hello) derives a per-credential key (PRF output) that we
// stretch with HKDF and use to AES-GCM-encrypt the wallet password. Only the
// ciphertext, a random salt, the IV, and the credential id are persisted; the
// key never leaves the authenticator-gated context and is reconstructed only
// after a successful biometric user-verification.
//
// If the platform authenticator (or the PRF extension) is unavailable, every
// entry point fails closed: the caller hides the feature and the wallet stays
// on password unlock. We never fall back to an insecure storage scheme.

import { biometricDebug } from "./biometric-debug";

export type BiometricErrorCode =
  | "unavailable" // no platform authenticator in this runtime
  | "unsupported" // authenticator present but PRF (secure key) not supported
  | "cancelled" // user dismissed / aborted the OS prompt
  | "failed"; // anything else

export class BiometricError extends Error {
  readonly code: BiometricErrorCode;

  constructor(code: BiometricErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BiometricError";
    this.code = code;
  }
}

export type BiometricEnrollInput = {
  userId: string;
  username: string;
  displayName: string;
  secret: string;
  rpName?: string;
};

export type BiometricEnrollment = {
  credentialId: string; // base64url(rawId)
  prfSalt: string; // base64
  iv: string; // base64
  wrappedSecret: string; // base64(AES-GCM ciphertext of `secret`)
  createdAt: string; // ISO timestamp
};

export type BiometricUnlockInput = {
  credentialId: string;
  prfSalt: string;
  iv: string;
  wrappedSecret: string;
};

// Minimal local typings for the WebAuthn PRF extension — the DOM lib shipped
// with our TS version does not yet describe it.
type PrfExtensionInput = {
  prf?: { eval?: { first: BufferSource } };
};
type PrfExtensionOutput = {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};

// WebCrypto's BufferSource wants an ArrayBuffer-backed view (not ArrayBufferLike,
// which could be a SharedArrayBuffer); we construct every byte buffer this way.
type CryptoBytes = Uint8Array<ArrayBuffer>;

const WEBAUTHN_TIMEOUT_MS = 60_000;
const HKDF_INFO = "simpl-biometric-unlock-v1";

export class BiometricUnlockService {
  // Gate for SHOWING the feature: a user-verifying platform authenticator must
  // exist right now. PRF support itself can only be probed by enrolling, so the
  // enroll flow fails closed with `unsupported` when it is missing.
  async isAvailable(): Promise<boolean> {
    try {
      if (!this.isWebAuthnSupported()) {
        return false;
      }
      if (
        typeof PublicKeyCredential
          .isUserVerifyingPlatformAuthenticatorAvailable !== "function"
      ) {
        return false;
      }
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async enroll(input: BiometricEnrollInput): Promise<BiometricEnrollment> {
    if (!(await this.isAvailable())) {
      throw new BiometricError("unavailable");
    }

    const prfSalt = this.randomBytes(32);

    let credential: PublicKeyCredential;
    try {
      const created = await navigator.credentials.create({
        publicKey: {
          challenge: this.randomBytes(32),
          rp: { name: input.rpName ?? "SIMPL Wallet" },
          user: {
            id: this.textToBytes(input.userId),
            name: input.username,
            displayName: input.displayName,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: WEBAUTHN_TIMEOUT_MS,
          attestation: "none",
          extensions: {
            prf: { eval: { first: prfSalt } },
          } as PrfExtensionInput,
        },
      });

      if (!(created instanceof PublicKeyCredential)) {
        throw new BiometricError("failed");
      }
      credential = created;
    } catch (error) {
      throw this.normalizeError(error);
    }

    const extensions =
      credential.getClientExtensionResults() as PrfExtensionOutput;

    // The authenticator must advertise PRF support, otherwise we cannot derive a
    // biometric-bound key and must refuse rather than store anything weaker.
    if (!extensions.prf || extensions.prf.enabled === false) {
      throw new BiometricError("unsupported");
    }

    const credentialId = this.bytesToBase64Url(
      new Uint8Array(credential.rawId),
    );

    // Some platforms return the PRF result straight from create(); others only
    // confirm `enabled` and require a follow-up get() to evaluate it.
    let prfOutput = extensions.prf.results?.first;
    if (!prfOutput) {
      prfOutput = await this.evaluatePrf(credentialId, prfSalt);
    }

    const key = await this.deriveKey(prfOutput);
    const iv = this.randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      this.textToBytes(input.secret),
    );

    return {
      credentialId,
      prfSalt: this.bytesToBase64(prfSalt),
      iv: this.bytesToBase64(iv),
      wrappedSecret: this.bytesToBase64(new Uint8Array(ciphertext)),
      createdAt: new Date().toISOString(),
    };
  }

  async unlock(
    input: BiometricUnlockInput,
    options?: { signal?: AbortSignal; skipAvailabilityCheck?: boolean },
  ): Promise<string> {
    // The availability probe (isUserVerifyingPlatformAuthenticatorAvailable) is
    // an async hop. When unlock() is driven straight from a click handler, that
    // extra await before navigator.credentials.get() can consume the transient
    // user activation — which is exactly what kept the Chrome side panel from
    // ever raising the OS prompt. Callers that have already confirmed
    // availability (the button only renders when biometricUsable === true) pass
    // skipAvailabilityCheck so the very first await IS the WebAuthn assertion.
    if (!options?.skipAvailabilityCheck && !(await this.isAvailable())) {
      throw new BiometricError("unavailable");
    }

    const prfOutput = await this.evaluatePrf(
      input.credentialId,
      this.base64ToBytes(input.prfSalt),
      options?.signal,
    );

    const key = await this.deriveKey(prfOutput);

    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: this.base64ToBytes(input.iv) },
        key,
        this.base64ToBytes(input.wrappedSecret),
      );
    } catch {
      // A failed decrypt means the wrapped secret no longer matches this
      // credential (e.g. credential rotated) — treat as a hard failure so the
      // caller falls back to password unlock.
      biometricDebug("unlock:decrypt-failed");
      throw new BiometricError("failed");
    }

    return new TextDecoder().decode(plaintext);
  }

  // Run a WebAuthn assertion and return the PRF output for `salt`. An optional
  // `signal` lets the caller abort a hung prompt (e.g. a side panel that never
  // surfaces the OS dialog); an abort surfaces as a "cancelled" BiometricError.
  private async evaluatePrf(
    credentialId: string,
    salt: BufferSource,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    let assertion: Credential | null;
    biometricDebug("credentials.get:start");
    try {
      assertion = await navigator.credentials.get({
        signal,
        publicKey: {
          challenge: this.randomBytes(32),
          allowCredentials: [
            {
              id: this.base64UrlToBytes(credentialId),
              type: "public-key",
            },
          ],
          userVerification: "required",
          timeout: WEBAUTHN_TIMEOUT_MS,
          extensions: {
            prf: { eval: { first: salt } },
          } as PrfExtensionInput,
        },
      });
      biometricDebug("credentials.get:resolved");
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      const message = error instanceof Error ? error.message : String(error);
      biometricDebug("credentials.get:rejected", { name, message });
      throw this.normalizeError(error);
    }

    if (!(assertion instanceof PublicKeyCredential)) {
      throw new BiometricError("failed");
    }

    const result = (assertion.getClientExtensionResults() as PrfExtensionOutput)
      .prf?.results?.first;

    if (!result) {
      biometricDebug("prf:unsupported");
      throw new BiometricError("unsupported");
    }
    biometricDebug("prf:ok");

    return result;
  }

  private async deriveKey(prfOutput: BufferSource): Promise<CryptoKey> {
    const ikm = await crypto.subtle.importKey(
      "raw",
      prfOutput,
      "HKDF",
      false,
      ["deriveKey"],
    );

    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: this.allocBytes(0),
        info: this.textToBytes(HKDF_INFO),
      },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private normalizeError(error: unknown): BiometricError {
    if (error instanceof BiometricError) {
      return error;
    }
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "AbortError") {
        return new BiometricError("cancelled", error.message);
      }
      if (error.name === "NotSupportedError") {
        return new BiometricError("unsupported", error.message);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return new BiometricError("failed", message);
  }

  private isWebAuthnSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.credentials !== "undefined" &&
      typeof PublicKeyCredential !== "undefined"
    );
  }

  private allocBytes(length: number): CryptoBytes {
    return new Uint8Array(new ArrayBuffer(length)) as CryptoBytes;
  }

  private randomBytes(length: number): CryptoBytes {
    const bytes = this.allocBytes(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  private textToBytes(value: string): CryptoBytes {
    const encoded = new TextEncoder().encode(value);
    const bytes = this.allocBytes(encoded.length);
    bytes.set(encoded);
    return bytes;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  private base64ToBytes(base64: string): CryptoBytes {
    const binary = atob(base64);
    const bytes = this.allocBytes(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private bytesToBase64Url(bytes: Uint8Array): string {
    return this.bytesToBase64(bytes)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }

  private base64UrlToBytes(base64Url: string): CryptoBytes {
    const base64 = base64Url
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
    return this.base64ToBytes(base64);
  }
}

export const biometricUnlockService = new BiometricUnlockService();
