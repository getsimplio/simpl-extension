// src/chains/ton/ton.history.ts
//
// Read-only native Toncoin activity (incoming + outgoing) via the centralized
// TON API client (Simpl gateway `GET /v1/ton/history?address=&limit=`). Mirrors
// the Solana/Bitcoin "live activity" path: the wallet merges these on-chain rows
// with any locally recorded sends so the Activity screen shows receives too.
//
// Native-only MVP: Jetton transfer events are skipped so a jetton amount is
// never mislabeled with GRAM's decimals. This module never signs or sends.

import { Address } from "@ton/core";
import {
  getTonTransactionExplorerUrl,
  type TonChainConfig,
} from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { tonApiClient, type TonHistoryEventDto } from "../../core/ton/tonApiClient";
import type { TonActivityItem } from "./ton.types";

// Encoding-independent address equality ("0:<hex>" canonical form). Falls back
// to a trimmed string compare for anything unparseable.
function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return Address.parse(a).toRawString() === Address.parse(b).toRawString();
  } catch {
    return a.trim() === b.trim();
  }
}

// Resolve a history event's direction relative to the queried account. Prefers
// the gateway's explicit `direction` field; falls back to from/to comparison.
function resolveDirection(
  event: TonHistoryEventDto,
  account: string,
): TonActivityItem["direction"] {
  const raw = (event.direction ?? "").toLowerCase();
  if (raw === "in" || raw === "incoming" || raw === "receive") return "incoming";
  if (raw === "out" || raw === "outgoing" || raw === "send") return "outgoing";

  const from = event.from ?? event.fromAddress;
  const to = event.to ?? event.toAddress;
  const fromSelf = sameAddress(from, account);
  const toSelf = sameAddress(to, account);
  if (fromSelf && toSelf) return "self";
  if (toSelf) return "incoming";
  if (fromSelf) return "outgoing";
  return "self";
}

// Map a history event's outcome onto the wallet's shared activity statuses.
// On-chain history events are settled, so the default is "confirmed"; an
// explicit failure/pending signal overrides it.
function resolveStatus(event: TonHistoryEventDto): TonActivityItem["status"] {
  const status = (event.status ?? "").toLowerCase();
  if (status === "failed" || event.success === false) return "failed";
  if (status === "pending" || status === "submitted") return "submitted";
  return "confirmed";
}

function resolveTimestamp(event: TonHistoryEventDto): number | null {
  const t = event.timestamp ?? event.utime ?? event.time;
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}

// Load recent native-Toncoin activity for `address`. Returns [] for an invalid
// address (never throws on that) and skips jetton events. Transport/API failures
// propagate as a coded TonError — the wallet layer swallows them to local-only
// history, so the Activity screen still shows recorded sends.
export async function loadTonActivity(
  config: TonChainConfig,
  address: string,
  limit = 15,
): Promise<TonActivityItem[]> {
  if (!isValidTonAddress(address)) {
    return [];
  }

  const payload = await tonApiClient.getHistory(config, address, limit);
  const events =
    payload.items ?? payload.events ?? payload.transactions ?? [];

  const out: TonActivityItem[] = [];

  for (const event of events) {
    // Native-only: skip jetton transfers (ambiguous symbol/decimals).
    if (event.isJetton === true || event.jettonMaster) continue;

    const hash = event.hash ?? event.txHash;
    if (!hash) continue;

    let amountNano: bigint;
    try {
      amountNano = BigInt(event.amountNano ?? event.amount ?? 0);
    } catch {
      amountNano = 0n;
    }
    if (amountNano < 0n) amountNano = -amountNano;

    out.push({
      hash,
      direction: resolveDirection(event, address),
      amountNano,
      status: resolveStatus(event),
      timestamp: resolveTimestamp(event),
      explorerUrl: getTonTransactionExplorerUrl(config, hash),
    });
  }

  // Pending first, then newest-first by timestamp.
  return out.sort((a, b) => {
    const aPending = a.status === "submitted";
    const bPending = b.status === "submitted";
    if (aPending !== bPending) return aPending ? -1 : 1;
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });
}
