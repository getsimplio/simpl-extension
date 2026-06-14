// src/core/transactions/transaction-history.service.ts

export type TransactionHistoryDirection =
  | "send"
  | "receive"
  | "swap"
  | "bridge";

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
  // Per-leg token mints/contract addresses (non-EVM swaps). Used to match swap
  // history to an asset by mint rather than symbol, which can collide.
  swapFromMint?: string;
  swapToMint?: string;
  swapRoute?: string;
  swapSimpleFee?: string;
  swapNetworkFee?: string;
  swapSlippage?: string;
  swapMinimumReceived?: string;

  // Cross-chain bridge legs (direction "bridge"). Source/destination chains
  // differ, so each leg carries its own chain id + name for display.
  bridgeFromChainId?: number;
  bridgeToChainId?: number;
  bridgeFromChainName?: string;
  bridgeToChainName?: string;
  bridgeFromSymbol?: string;
  bridgeFromAmount?: string;
  bridgeToSymbol?: string;
  bridgeToAmount?: string;
  bridgeProvider?: string;
  bridgeFee?: string;
  // Source-chain setup tx that ran before the bridge (e.g. native SOL → wSOL
  // wrap). Stored alongside the main bridge tx so both are inspectable; the
  // bridge tx (hash) remains the primary record.
  bridgeSetupTxHash?: string;
  // Granular bridge status, kept SEPARATE from the single overall `status` badge
  // so source-chain confirmation is never confused with cross-chain completion:
  //   bridgeSourceTxStatus — the SOURCE tx landed: submitted | confirmed | failed
  //   bridgeStatus         — CROSS-CHAIN completion: pending | completed | failed | unknown
  bridgeSourceTxStatus?: "submitted" | "confirmed" | "failed";
  bridgeStatus?: "pending" | "completed" | "failed" | "unknown";

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

  // Like listByAccount but matches any of several addresses — used for accounts
  // that hold addresses in more than one family (e.g. an EVM address plus a
  // TRON address) so their activity appears together.
  listByAddresses(
    addresses: Array<string | null | undefined>,
  ): TransactionHistoryItem[] {
    const set = new Set(
      addresses
        .filter((address): address is string => Boolean(address))
        .map(normalizeAddress),
    );

    if (set.size === 0) return [];

    return this.list().filter((item) => {
      return (
        set.has(normalizeAddress(item.fromAddress)) ||
        set.has(normalizeAddress(item.toAddress))
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

    // Monotonicity: never downgrade a confirmed row back to pending because a
    // later (possibly stale/failed) status read came back "submitted".
    if (existing.status === "confirmed" && input.status === "submitted") {
      return existing;
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

  // Reconcile a cross-chain bridge row's granular statuses and derive the overall
  // `status` badge from them. Both granular statuses are MONOTONIC — once a
  // terminal value (confirmed/failed for source; completed/failed for bridge) is
  // recorded it is never walked back by a later transient/stale read. The overall
  // `status` only flips to "confirmed" when the bridge COMPLETES (source
  // confirmation alone keeps it pending so the UI can show "In progress").
  updateBridgeReconcile(input: {
    chainId: number;
    hash: string;
    sourceTxStatus?: "submitted" | "confirmed" | "failed";
    bridgeStatus?: "pending" | "completed" | "failed" | "unknown";
  }): TransactionHistoryItem | null {
    const id = createTransactionId({ chainId: input.chainId, hash: input.hash });
    const current = this.list();
    const existing = current.find((item) => item.id === id);
    if (!existing) return null;

    const prevSource = existing.bridgeSourceTxStatus;
    const nextSource: "submitted" | "confirmed" | "failed" =
      prevSource === "confirmed" || prevSource === "failed"
        ? prevSource
        : (input.sourceTxStatus ?? prevSource ?? "submitted");

    const prevBridge = existing.bridgeStatus;
    let nextBridge: "pending" | "completed" | "failed" | "unknown" =
      prevBridge ?? "pending";
    if (prevBridge !== "completed" && prevBridge !== "failed") {
      if (
        input.bridgeStatus === "completed" ||
        input.bridgeStatus === "failed" ||
        input.bridgeStatus === "pending"
      ) {
        nextBridge = input.bridgeStatus;
      } else {
        nextBridge = prevBridge ?? "unknown"; // "unknown"/undefined → keep prior
      }
    }

    // Derive the overall status (never downgrade an already-confirmed row).
    let status = existing.status;
    if (existing.status !== "confirmed") {
      if (nextBridge === "completed") {
        status = "confirmed";
      } else if (nextBridge === "failed" || nextSource === "failed") {
        status = "failed";
      }
      // else: leave "submitted" — source-confirmed alone is still in progress.
    }

    if (
      status === existing.status &&
      nextSource === existing.bridgeSourceTxStatus &&
      nextBridge === existing.bridgeStatus
    ) {
      return existing; // no-op
    }

    const updated: TransactionHistoryItem = {
      ...existing,
      status,
      bridgeSourceTxStatus: nextSource,
      bridgeStatus: nextBridge,
      updatedAt: new Date().toISOString(),
    };
    this.save(current.map((item) => (item.id === id ? updated : item)));
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

  clearByAddresses(addresses: Array<string | null | undefined>): void {
    const set = new Set(
      addresses
        .filter((address): address is string => Boolean(address))
        .map(normalizeAddress),
    );

    if (set.size === 0) return;

    const nextItems = this.list().filter((item) => {
      return (
        !set.has(normalizeAddress(item.fromAddress)) &&
        !set.has(normalizeAddress(item.toAddress))
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
