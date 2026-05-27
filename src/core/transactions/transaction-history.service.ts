// src/core/transactions/transaction-history.service.ts

export type TransactionHistoryDirection = "send" | "receive" | "swap";

export type TransactionHistoryStatus = "submitted" | "confirmed" | "failed";

export type TransactionHistoryItem = {
  id: string;
  hash: string;
  chainId: number;
  chainName: string;
  direction: TransactionHistoryDirection;
  status: TransactionHistoryStatus;

  assetType: string;
  assetSymbol: string;
  assetName: string;
  contractAddress: string | null;

  amount: string;
  fromAddress: string;
  toAddress: string;

  swapFromSymbol?: string;
  swapFromAmount?: string;
  swapToSymbol?: string;
  swapToAmount?: string;
  swapRoute?: string;
  swapSimpleFee?: string;
  swapNetworkFee?: string;
  swapSlippage?: string;
  swapMinimumReceived?: string;

  explorerUrl: string | null;

  createdAt: string;
  updatedAt: string;
};

type AddTransactionInput = Omit<TransactionHistoryItem, "id" | "updatedAt">;

const STORAGE_KEY = "simple:transactionHistory:v1";
const MAX_HISTORY_ITEMS = 200;

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function createTransactionId(input: {
  chainId: number;
  hash: string;
}): string {
  return `${input.chainId}:${input.hash.toLowerCase()}`;
}

function isTransactionHistoryItem(value: unknown): value is TransactionHistoryItem {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<TransactionHistoryItem>;

  return (
    typeof item.id === "string" &&
    typeof item.hash === "string" &&
    typeof item.chainId === "number" &&
    typeof item.chainName === "string" &&
    typeof item.direction === "string" &&
    typeof item.status === "string" &&
    typeof item.assetSymbol === "string" &&
    typeof item.amount === "string" &&
    typeof item.fromAddress === "string" &&
    typeof item.toAddress === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

export class TransactionHistoryService {
  list(): TransactionHistoryItem[] {
    if (!isBrowserStorageAvailable()) return [];

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);

      if (!raw) return [];

      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(isTransactionHistoryItem)
        .sort((a, b) => {
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        });
    } catch {
      return [];
    }
  }

  listByAccount(accountAddress: string): TransactionHistoryItem[] {
    const normalizedAccount = normalizeAddress(accountAddress);

    return this.list().filter((item) => {
      return (
        normalizeAddress(item.fromAddress) === normalizedAccount ||
        normalizeAddress(item.toAddress) === normalizedAccount
      );
    });
  }

  addTransaction(input: AddTransactionInput): TransactionHistoryItem {
    const now = new Date().toISOString();

    const item: TransactionHistoryItem = {
      ...input,
      id: createTransactionId({
        chainId: input.chainId,
        hash: input.hash,
      }),
      updatedAt: now,
    };

    const current = this.list();

    const nextItems = [
      item,
      ...current.filter((currentItem) => currentItem.id !== item.id),
    ].slice(0, MAX_HISTORY_ITEMS);

    this.save(nextItems);

    return item;
  }

  updateStatus(input: {
    chainId: number;
    hash: string;
    status: TransactionHistoryStatus;
  }): TransactionHistoryItem | null {
    const id = createTransactionId({
      chainId: input.chainId,
      hash: input.hash,
    });

    const current = this.list();
    const existing = current.find((item) => item.id === id);

    if (!existing) {
      return null;
    }

    const updated: TransactionHistoryItem = {
      ...existing,
      status: input.status,
      updatedAt: new Date().toISOString(),
    };

    const nextItems = current.map((item) => {
      return item.id === id ? updated : item;
    });

    this.save(nextItems);

    return updated;
  }

  clear(): void {
    this.save([]);
  }

  clearByAccount(accountAddress: string): void {
    const normalizedAccount = normalizeAddress(accountAddress);

    const nextItems = this.list().filter((item) => {
      return (
        normalizeAddress(item.fromAddress) !== normalizedAccount &&
        normalizeAddress(item.toAddress) !== normalizedAccount
      );
    });

    this.save(nextItems);
  }

  private save(items: TransactionHistoryItem[]): void {
    if (!isBrowserStorageAvailable()) return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Local transaction history is optional.
    }
  }
}

export const transactionHistoryService = new TransactionHistoryService();
