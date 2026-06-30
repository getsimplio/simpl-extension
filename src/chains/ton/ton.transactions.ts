// src/chains/ton/ton.transactions.ts
//
// Native Toncoin send: wallet-state read, transfer build/sign, broadcast and
// confirmation. TON wallets are SMART CONTRACTS, so a "send" is an external-in
// message to the sender's own wallet contract carrying one internal transfer.
// We build and sign it with the SAME audited @ton SDK WalletContractV4 used for
// address derivation (no hand-rolled contract code BoC), then broadcast the
// serialized message via the Simpl API TON proxy `POST /v1/ton/send-boc`. The
// proxy fronts the upstream broadcast provider server-side; no provider key
// ships in this bundle and the proxy only ever receives the already-signed BOC.
//
// Fees: TON has no cheap exact pre-flight fee estimate without full emulation,
// so we DON'T guess a precise number — we keep a conservative fee RESERVE
// (TON_FEE_RESERVE_NANO) free in the wallet and surface it as the estimated
// (max) network fee. The actual fee is paid from the wallet balance
// (PAY_GAS_SEPARATELY), never carved out of the sent amount.
//
// SECURITY: the signing secret key is passed in by the wallet service, used only
// with the local SDK signer, and never logged, persisted or sent to any API.

import {
  Address,
  beginCell,
  external,
  internal,
  storeMessage,
  SendMode,
} from "@ton/core";
import type { KeyPair } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";
import {
  getTonAddressExplorerUrl,
  tonApiUrl,
  type TonChainConfig,
} from "./ton.config";
import { isValidTonAddress } from "./ton.address";
import { normalizeTonError, tonErrorFor } from "./ton.errors";
import type { TonAccountState } from "./ton.types";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";

// Conservative network-fee reserve kept free in the wallet on every send. A
// simple v4 transfer costs well under this (~0.005–0.01 TON, a bit more for the
// first deploy + forwarding); 0.05 TON is a safe upper bound for the MVP and is
// shown to the user as the estimated (max) fee.
export const TON_FEE_RESERVE_NANO = 50_000_000n; // 0.05 TON

// --- Wallet state (balance + deployment + seqno) -------------------------

export type TonWalletInformation = {
  balanceNano: bigint;
  state: TonAccountState;
  // Contract seqno; 0 for a not-yet-deployed (uninit/nonexist) wallet.
  seqno: number;
  deployed: boolean;
};

// Normalized account info from the Simpl API TON proxy `/account` endpoint.
type ProxyAccountInfo = {
  state?: string;
  balanceNano?: string | number;
  seqno?: number;
  isActive?: boolean;
};

function mapState(raw: string | undefined, balance: bigint): TonAccountState {
  const value = (raw ?? "").toLowerCase();
  if (value === "active") return "active";
  if (value === "frozen") return "frozen";
  if (value === "nonexist") return "nonexist";
  // "uninit" / "uninitialized" / unknown → disambiguate by balance.
  return balance > 0n ? "uninit" : "nonexist";
}

// Read balance + deployment state + seqno in one Simpl API proxy call. Used for
// the send pre-flight (balance/fee checks and the seqno the transfer is signed
// for). The proxy fronts the provider server-side; no key ships in this bundle.
export async function getTonWalletInformation(
  address: string,
  config: TonChainConfig,
): Promise<TonWalletInformation> {
  const url = tonApiUrl(
    config,
    `/account?address=${encodeURIComponent(address)}`,
  );

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw normalizeTonError(error, "TON_SEQNO_FETCH_FAILED");
  }
  if (!response.ok) {
    throw tonErrorFor("TON_SEQNO_FETCH_FAILED", `TON API responded ${response.status}.`);
  }

  let payload: ProxyAccountInfo;
  try {
    payload = (await response.json()) as ProxyAccountInfo;
  } catch (error) {
    throw normalizeTonError(error, "TON_SEQNO_FETCH_FAILED");
  }

  let balanceNano: bigint;
  try {
    balanceNano = BigInt(payload.balanceNano ?? 0);
  } catch {
    balanceNano = 0n;
  }
  if (balanceNano < 0n) balanceNano = 0n;

  const state = mapState(payload.state, balanceNano);

  return {
    balanceNano,
    state,
    seqno: Number.isInteger(payload.seqno) ? (payload.seqno as number) : 0,
    // A deployed wallet contract is the "active" state; the proxy also surfaces
    // an explicit isActive flag.
    deployed: payload.isActive === true || state === "active",
  };
}

// --- Amount / balance guard (pure, testable) -----------------------------

// Throw a coded error when `amountNano` can't be sent from `balanceNano` while
// keeping the fee reserve free. Order matters: invalid amount → over balance →
// no room for fee. Pure so it can be unit-tested without the network.
export function assertTonSendAmount(
  balanceNano: bigint,
  amountNano: bigint,
): void {
  if (amountNano <= 0n) {
    throw tonErrorFor("TON_INVALID_AMOUNT");
  }
  if (amountNano > balanceNano) {
    throw tonErrorFor("TON_INSUFFICIENT_BALANCE");
  }
  if (amountNano + TON_FEE_RESERVE_NANO > balanceNano) {
    throw tonErrorFor("TON_INSUFFICIENT_BALANCE_FOR_FEE");
  }
}

// --- Send native TON -----------------------------------------------------

export type SendNativeTonParams = {
  config: TonChainConfig;
  // Signing material from the wallet service (service-layer only).
  keyPair: KeyPair;
  // Sender wallet address (user-friendly), for the explorer link + sanity check.
  fromAddress: string;
  toAddress: string;
  amountNano: bigint;
};

export type SendNativeTonResult = {
  // External-message hash (hex), used as the activity row id + reconciliation key.
  hash: string;
  explorerUrl: string | null;
};

// Resolve the recipient Address and the bounce flag. A user-friendly address
// encodes the sender's intent (EQ = bounceable, UQ = non-bounceable); we respect
// it. Raw addresses default to non-bounceable so funds aren't returned when the
// recipient wallet isn't deployed yet.
function resolveRecipient(toAddress: string): { address: Address; bounce: boolean } {
  try {
    const friendly = Address.parseFriendly(toAddress.trim());
    return { address: friendly.address, bounce: friendly.isBounceable };
  } catch {
    return { address: Address.parse(toAddress.trim()), bounce: false };
  }
}

export async function sendNativeTon(
  params: SendNativeTonParams,
): Promise<SendNativeTonResult> {
  const { config, keyPair, fromAddress, toAddress, amountNano } = params;

  if (!isValidTonAddress(toAddress)) {
    throw tonErrorFor("TON_INVALID_RECIPIENT");
  }
  if (amountNano <= 0n) {
    throw tonErrorFor("TON_INVALID_AMOUNT");
  }

  // Pre-flight: balance + deployment + seqno.
  const info = await getTonWalletInformation(fromAddress, config);

  if (info.state === "frozen") {
    throw tonErrorFor("TON_WALLET_NOT_ACTIVE");
  }

  // Balance / fee-reserve guard (throws TON_INSUFFICIENT_BALANCE[_FOR_FEE]).
  assertTonSendAmount(info.balanceNano, amountNano);

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const { address: recipient, bounce } = resolveRecipient(toAddress);

  // Build + sign the transfer body. Gas is paid separately (from balance, not
  // from the sent amount); IGNORE_ERRORS keeps a failed action from bouncing the
  // whole external message. A not-yet-deployed wallet (seqno 0) carries its
  // StateInit so this first send also deploys the contract.
  let bocBase64: string;
  let msgHash: string;
  try {
    const transfer = wallet.createTransfer({
      seqno: info.seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages: [internal({ to: recipient, value: amountNano, bounce })],
    });

    const extMessage = external({
      to: wallet.address,
      init: info.deployed ? undefined : wallet.init,
      body: transfer,
    });

    const extCell = beginCell().store(storeMessage(extMessage)).endCell();
    bocBase64 = extCell.toBoc().toString("base64");
    msgHash = extCell.hash().toString("hex");
  } catch (error) {
    throw normalizeTonError(error, "TON_SIGN_FAILED");
  }

  // Broadcast the serialized external message through the Simpl API proxy. The
  // proxy receives ONLY the already-signed BOC and a public address context —
  // never any secret/seed/key material.
  const url = tonApiUrl(config, `/send-boc`);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ boc: bocBase64 }),
    });
  } catch (error) {
    throw normalizeTonError(error, "TON_BROADCAST_FAILED");
  }

  if (!response.ok) {
    throw tonErrorFor(
      response.status === 429 || response.status >= 500
        ? "TON_PROVIDER_UNAVAILABLE"
        : "TON_BROADCAST_FAILED",
      `TON broadcast responded ${response.status}.`,
    );
  }

  let payload: { ok?: boolean; error?: string };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = { ok: true };
  }
  if (payload.ok === false) {
    throw tonErrorFor("TON_BROADCAST_FAILED", payload.error);
  }

  return {
    hash: msgHash,
    // Link to the sender account page — Tonviewer reliably surfaces the outgoing
    // tx there (an external-message hash does not resolve at /transaction/).
    explorerUrl: getTonAddressExplorerUrl(config, fromAddress),
  };
}

// --- Confirmation / reconciliation ---------------------------------------

// Resolve a sent external message to its on-chain transaction status via the
// Simpl API proxy (`GET /v1/ton/tx/status?account=&hash=`). Safe by default:
// anything other than a clearly-resolved transaction returns "submitted" (never
// a false "failed") so a hash-format mismatch or transient API issue can't
// wrongly mark a real, funds-moving send as failed.
export async function getTonTransactionStatus(
  config: TonChainConfig,
  account: string,
  hash: string,
): Promise<TransactionHistoryStatus> {
  // The proxy needs the sender account to locate the message on-chain. Without
  // it we can't resolve a status — degrade safely to "submitted".
  if (!account) return "submitted";

  const url = tonApiUrl(
    config,
    `/tx/status?account=${encodeURIComponent(account)}&hash=${encodeURIComponent(hash)}`,
  );

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return "submitted";
    if (!response.ok) return "submitted";

    const tx = (await response.json()) as {
      status?: string;
      success?: boolean;
      aborted?: boolean;
    };
    // Prefer the proxy's normalized status when present.
    const status = (tx.status ?? "").toLowerCase();
    if (status === "confirmed") return "confirmed";
    if (status === "failed") return "failed";
    if (status === "submitted" || status === "pending") return "submitted";
    // Fall back to the raw success/aborted signals.
    if (tx.success === true) return "confirmed";
    if (tx.success === false || tx.aborted === true) return "failed";
    return "submitted";
  } catch {
    return "submitted";
  }
}

// Poll a sent message to confirmation. Throws TON_CONFIRMATION_TIMEOUT if it
// neither confirms nor fails within the window.
export async function waitForTonTransaction(
  config: TonChainConfig,
  account: string,
  hash: string,
  timeoutMs: number,
): Promise<"confirmed" | "failed"> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getTonTransactionStatus(config, account, hash);
    if (status === "confirmed") return "confirmed";
    if (status === "failed") return "failed";
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  throw tonErrorFor("TON_CONFIRMATION_TIMEOUT");
}
