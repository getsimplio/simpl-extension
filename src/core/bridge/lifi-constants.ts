// src/core/bridge/lifi-constants.ts
//
// LI.FI chain / address constants, kept in a LEAF module with no import.meta.env
// access so that non-Vite consumers (the tsx-run release gates, e.g.
// scripts/check-runtime-config.ts) can import them without pulling in the
// bridge service's module-level env resolution. lifi-bridge.service.ts
// re-exports everything here — import from either place.

// LI.FI's sentinel for a chain's native asset (ETH / BNB / MATIC …).
export const LIFI_NATIVE_ADDRESS =
  "0x0000000000000000000000000000000000000000";

// LI.FI's Solana (SVM) chain id. Used to detect Solana-source routes.
export const LIFI_SOLANA_CHAIN_ID = 1151111081099710;

// The wSOL mint — LI.FI's/Jupiter's canonical identifier for NATIVE SOL. The
// LI.FI token catalog reports native SOL under this mint with isNative=false,
// so consumers matching "the chain's native asset" must recognize it. (Kept
// here rather than imported from solana-swap.service.ts, whose module-level
// import.meta.env access would break the tsx-run release gates.)
export const LIFI_SOLANA_NATIVE_MINT =
  "So11111111111111111111111111111111111111112";

// LI.FI's TRON (TVM) chain id. Identical to the wallet's canonical TRON routing
// key (TRON_MAINNET_CHAIN_ID, 0x2b6653dc) — LI.FI returns Tron under this id with
// chainType "TVM". Used to detect TRON-source / TRON-destination routes.
export const LIFI_TRON_CHAIN_ID = 728126428;

// LI.FI's sentinel address for NATIVE TRX. Unlike EVM/SVM natives (the 0x000…0
// zero address), LI.FI identifies native TRX by this specific base58 address —
// using the EVM zero address for TRON native would be rejected. Used to seed the
// token picker's TRX entry so it matches LI.FI's canonical identifier.
export const LIFI_TRON_NATIVE_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
