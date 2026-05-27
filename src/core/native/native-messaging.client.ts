export type NativeMessageRequest =
  | {
      type: "isAvailable";
    }
  | {
      type: "ping";
    }
  | {
      type: "storeVaultKey";
      walletId: string;
      vaultKeyBase64: string;
    }
  | {
      type: "getVaultKey";
      walletId: string;
    }
  | {
      type: "deleteVaultKey";
      walletId: string;
    };

export type NativeMessageResponse<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export type NativeAvailability = {
  available: boolean;
  platform: string;
  host: string;
  biometryType?: string;
  error?: string | null;
};

export type StoreVaultKeyResult = {
  stored: boolean;
  walletId: string;
};

export type GetVaultKeyResult = {
  walletId: string;
  vaultKeyBase64: string;
};

export type DeleteVaultKeyResult = {
  deleted: boolean;
  walletId: string;
};

export const NATIVE_HOST_NAME = "com.local_evm_wallet.keychain";

export class NativeMessagingClient {
  async send<T = unknown>(
    request: NativeMessageRequest
  ): Promise<NativeMessageResponse<T>> {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.sendNativeMessage
    ) {
      return {
        ok: false,
        error: "Native messaging is not available.",
      };
    }

    return new Promise((resolve) => {
      chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        request,
        (response: NativeMessageResponse<T> | undefined) => {
          const runtimeError = chrome.runtime.lastError;

          if (runtimeError) {
            resolve({
              ok: false,
              error: runtimeError.message ?? "Native messaging error.",
            });
            return;
          }

          if (!response) {
            resolve({
              ok: false,
              error: "Empty native host response.",
            });
            return;
          }

          resolve(response);
        }
      );
    });
  }

  async getAvailability(): Promise<NativeMessageResponse<NativeAvailability>> {
    return this.send<NativeAvailability>({
      type: "isAvailable",
    });
  }

  async storeVaultKey(
    walletId: string,
    vaultKeyBase64: string
  ): Promise<NativeMessageResponse<StoreVaultKeyResult>> {
    return this.send<StoreVaultKeyResult>({
      type: "storeVaultKey",
      walletId,
      vaultKeyBase64,
    });
  }

  async getVaultKey(
    walletId: string
  ): Promise<NativeMessageResponse<GetVaultKeyResult>> {
    return this.send<GetVaultKeyResult>({
      type: "getVaultKey",
      walletId,
    });
  }

  async deleteVaultKey(
    walletId: string
  ): Promise<NativeMessageResponse<DeleteVaultKeyResult>> {
    return this.send<DeleteVaultKeyResult>({
      type: "deleteVaultKey",
      walletId,
    });
  }
}

export const nativeMessagingClient = new NativeMessagingClient();
