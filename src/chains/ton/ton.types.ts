// src/chains/ton/ton.types.ts
//
// Shared types for the TON (Ed25519, smart-contract wallet) adapter. On-chain
// amounts are always integer base units (nanoton) as bigint; the UI only ever
// sees formatted decimal strings.

// A TON account's contract-deployment state, as reported by toncenter:
// - "nonexist" → address has never been touched on-chain (no balance, no code)
// - "uninit"   → address has a balance but the wallet contract isn't deployed
//                yet (the first outgoing tx deploys it; receiving still works)
// - "active"   → wallet contract is deployed and live
// - "frozen"   → contract is frozen (storage debt); rare for wallets
export type TonAccountState = "nonexist" | "uninit" | "active" | "frozen";

// Native Toncoin balance for an address, in nanoton.
export type TonBalance = {
  raw: bigint;
  formatted: string;
  decimals: 9;
  symbol: "TON";
  // Contract-deployment state, so callers can distinguish "0 because empty"
  // from "uninitialised wallet" without a second request.
  state: TonAccountState;
};

// A derived TON account. `publicKey` is the Ed25519 public key (hex). `address`
// is the user-friendly, non-bounceable mainnet form (UQ…) shown for receiving.
export type DerivedTonAccount = {
  address: string;
  publicKey: string;
  derivationPath: string;
};

// A trusted Jetton balance held by an account, normalized for the adapter.
// `master` is the canonical user-friendly master address (display / price
// identity / explorer). Amounts are integer base units (bigint) with the
// jetton's canonical decimals; `usdPrice` is the live read-API spot price (USD)
// when available, else null. Only trusted jettons reach this shape — spam and
// unknown jettons are filtered out before mapping.
export type TonJettonBalance = {
  master: string;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: bigint;
  formatted: string;
  usdPrice: number | null;
};
