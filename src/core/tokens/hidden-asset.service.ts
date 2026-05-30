// src/core/tokens/hidden-asset.service.ts

const HIDDEN_ASSETS_KEY = "simple:hiddenAssets";

type HiddenAssetsStore = Record<string, string[]>;

function readStore(): HiddenAssetsStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HIDDEN_ASSETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as HiddenAssetsStore;
  } catch {
    return {};
  }
}

function writeStore(store: HiddenAssetsStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIDDEN_ASSETS_KEY, JSON.stringify(store));
  } catch {
    // localStorage is optional.
  }
}

class HiddenAssetService {
  getHiddenAddresses(chainId: number): string[] {
    const store = readStore();
    const addresses = store[String(chainId)];
    return Array.isArray(addresses) ? addresses : [];
  }

  hideAsset(chainId: number, contractAddress: string): void {
    const normalized = contractAddress.toLowerCase();
    const store = readStore();
    const key = String(chainId);
    const current = store[key] ?? [];
    if (!current.includes(normalized)) {
      store[key] = [...current, normalized];
      writeStore(store);
    }
  }

  unhideAsset(chainId: number, contractAddress: string): void {
    const normalized = contractAddress.toLowerCase();
    const store = readStore();
    const key = String(chainId);
    const current = store[key] ?? [];
    store[key] = current.filter((addr) => addr !== normalized);
    writeStore(store);
  }

  isHidden(chainId: number, contractAddress: string): boolean {
    const normalized = contractAddress.toLowerCase();
    return this.getHiddenAddresses(chainId).includes(normalized);
  }
}

export const hiddenAssetService = new HiddenAssetService();
