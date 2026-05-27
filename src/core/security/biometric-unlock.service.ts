// src/core/security/biometric-unlock.service.ts

export type BiometricCredential = {
  credentialId: string;
  createdAt: string;
};

export type RegisterBiometricInput = {
  userId: string;
  username: string;
  displayName: string;
  rpName?: string;
};

export type AuthenticateBiometricInput = {
  credentialId: string;
};

type CryptoBytes = Uint8Array<ArrayBuffer>;

const WEBAUTHN_TIMEOUT_MS = 60_000;

export class BiometricUnlockService {
  async isAvailable(): Promise<boolean> {
    if (!this.isWebAuthnSupported()) {
      return false;
    }

    if (
      typeof PublicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable !== "function"
    ) {
      return false;
    }

    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }

  async register(
    input: RegisterBiometricInput
  ): Promise<BiometricCredential> {
    const available = await this.isAvailable();

    if (!available) {
      throw new Error("Biometric authentication is not available.");
    }

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: this.getRandomBytes(32),
        rp: {
          name: input.rpName ?? "EVM Wallet Extension",
        },
        user: {
          id: this.textToBytes(input.userId),
          name: input.username,
          displayName: input.displayName,
        },
        pubKeyCredParams: [
          {
            type: "public-key",
            alg: -7,
          },
          {
            type: "public-key",
            alg: -257,
          },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: WEBAUTHN_TIMEOUT_MS,
        attestation: "none",
      },
    });

    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error("Failed to create biometric credential.");
    }

    return {
      credentialId: this.bytesToBase64Url(
        new Uint8Array(credential.rawId) as CryptoBytes
      ),
      createdAt: new Date().toISOString(),
    };
  }

  async authenticate(
    input: AuthenticateBiometricInput
  ): Promise<boolean> {
    const available = await this.isAvailable();

    if (!available) {
      throw new Error("Biometric authentication is not available.");
    }

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: this.getRandomBytes(32),
        allowCredentials: [
          {
            id: this.base64UrlToBytes(input.credentialId),
            type: "public-key",
          },
        ],
        userVerification: "required",
        timeout: WEBAUTHN_TIMEOUT_MS,
      },
    });

    return assertion instanceof PublicKeyCredential;
  }

  private isWebAuthnSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.credentials !== "undefined" &&
      typeof PublicKeyCredential !== "undefined"
    );
  }

  private getRandomBytes(length: number): CryptoBytes {
    const bytes = new Uint8Array(new ArrayBuffer(length)) as CryptoBytes;
    crypto.getRandomValues(bytes);

    return bytes;
  }

  private textToBytes(value: string): CryptoBytes {
    const encoded = new TextEncoder().encode(value);
    const bytes = new Uint8Array(new ArrayBuffer(encoded.length)) as CryptoBytes;

    bytes.set(encoded);

    return bytes;
  }

  private bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }

  private base64UrlToBytes(base64Url: string): CryptoBytes {
    const base64 = base64Url
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(base64Url.length / 4) * 4, "=");

    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length)) as CryptoBytes;

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }
}

export const biometricUnlockService = new BiometricUnlockService();