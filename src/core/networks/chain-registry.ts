// src/core/networks/chain-registry.ts

export type ChainId = number;

// Address/transaction family a chain belongs to. EVM chains share ethers-based
// derivation, balances, signing and RPC; "tron" routes to the TRON adapter;
// "bitcoin" routes to the UTXO Bitcoin adapter (src/chains/bitcoin); "solana"
// routes to the Ed25519 Solana adapter (src/chains/solana); "ton" routes to the
// Ed25519 TON adapter (src/chains/ton) — TON is a smart-contract wallet chain.
// Chains keep a single numeric `chainId` as their routing key everywhere in the
// app (TRON uses its canonical EVM chain id 728126428 as that key; Bitcoin and
// Solana have no canonical numeric id, so they use the internal sentinel ids
// below) so existing EVM plumbing is untouched; `family` is the discriminator
// that selects the adapter.
export type ChainFamily = "evm" | "tron" | "bitcoin" | "solana" | "ton";

export type ChainConfig = {
  chainId: ChainId;
  family: ChainFamily;
  name: string;
  // Canonical user-facing network name, consistent across the whole app
  // (e.g. "BNB Chain", never "BNB Smart Chain"; "Ethereum", never
  // "Ethereum Mainnet"). UI label only — does not affect network logic.
  displayName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  blockExplorerUrl: string;
  isTestnet: boolean;
  // Token standard label shown in receive/network UIs (e.g. "ERC-20",
  // "BEP-20"). Display metadata only — does not affect network logic.
  standardLabel: string;
};

export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const BNB_SMART_CHAIN_ID = 56;
export const BASE_CHAIN_ID = 8453;
export const SEPOLIA_CHAIN_ID = 11155111;
// TRON Mainnet's canonical chain id (0x2b6653dc). Used as the single numeric
// routing key for TRON across the app; the human "tron-mainnet" id lives in
// src/chains/tron/tron.config.ts.
export const TRON_MAINNET_CHAIN_ID = 728126428;
// Bitcoin has no canonical numeric chain id. These are INTERNAL sentinel ids
// used only as the app's routing key; they are deliberately large and outside
// the range of real EVM chain ids so they can never collide. The human ids
// ("bitcoin-mainnet" / "bitcoin-testnet") live in src/chains/bitcoin/bitcoin.config.ts.
export const BITCOIN_MAINNET_CHAIN_ID = 5_757_000_001;
export const BITCOIN_TESTNET_CHAIN_ID = 5_757_000_002;
// Solana has no canonical numeric chain id either (it identifies clusters by
// name). These are INTERNAL sentinel ids used only as the app's routing key,
// kept in the same out-of-EVM-range block as the Bitcoin sentinels so they can
// never collide with a real EVM chain id. The human cluster ids
// ("solana-mainnet" / "solana-devnet") live in src/chains/solana/solana.config.ts.
export const SOLANA_MAINNET_CHAIN_ID = 5_757_000_101;
export const SOLANA_DEVNET_CHAIN_ID = 5_757_000_102;
// TON has no canonical numeric chain id (it identifies networks as workchains on
// mainnet/testnet). This is an INTERNAL sentinel id used only as the app's
// routing key, kept in the same out-of-EVM-range block as the other non-EVM
// sentinels so it can never collide with a real EVM chain id. The human
// "ton-mainnet" id lives in src/chains/ton/ton.config.ts. TON is a
// smart-contract wallet chain (Ed25519); see src/chains/ton.
export const TON_MAINNET_CHAIN_ID = 5_757_000_201;

export const DEFAULT_CHAINS: ChainConfig[] = [
  {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    family: "evm",
    name: "Ethereum Mainnet",
    displayName: "Ethereum",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    blockExplorerUrl: "https://etherscan.io",
    isTestnet: false,
    standardLabel: "ERC-20",
  },
  {
    chainId: BNB_SMART_CHAIN_ID,
    family: "evm",
    name: "BNB Smart Chain",
    displayName: "BNB Chain",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    rpcUrl: "https://bsc-rpc.publicnode.com",
    blockExplorerUrl: "https://bscscan.com",
    isTestnet: false,
    standardLabel: "BEP-20",
  },
  {
    chainId: BASE_CHAIN_ID,
    family: "evm",
    name: "Base",
    displayName: "Base",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://base-rpc.publicnode.com",
    blockExplorerUrl: "https://basescan.org",
    isTestnet: false,
    standardLabel: "ERC-20",
  },
  {
    chainId: TRON_MAINNET_CHAIN_ID,
    family: "tron",
    name: "TRON",
    displayName: "TRON",
    nativeCurrency: {
      name: "TRON",
      symbol: "TRX",
      decimals: 6,
    },
    rpcUrl: "https://api.trongrid.io",
    blockExplorerUrl: "https://tronscan.org",
    isTestnet: false,
    standardLabel: "TRC-20",
  },
  {
    chainId: BITCOIN_MAINNET_CHAIN_ID,
    family: "bitcoin",
    name: "Bitcoin",
    displayName: "Bitcoin",
    nativeCurrency: {
      name: "Bitcoin",
      symbol: "BTC",
      decimals: 8,
    },
    // UTXO chains have no JSON-RPC endpoint; the Esplora REST base URL lives in
    // bitcoin.config.ts. Kept here for display/parity only.
    rpcUrl: "https://blockstream.info/api",
    blockExplorerUrl: "https://mempool.space",
    isTestnet: false,
    standardLabel: "BTC",
  },
  {
    chainId: BITCOIN_TESTNET_CHAIN_ID,
    family: "bitcoin",
    name: "Bitcoin Testnet",
    displayName: "Bitcoin Testnet",
    nativeCurrency: {
      name: "Test Bitcoin",
      symbol: "BTC",
      decimals: 8,
    },
    rpcUrl: "https://blockstream.info/testnet/api",
    blockExplorerUrl: "https://mempool.space/testnet",
    isTestnet: true,
    standardLabel: "BTC Testnet",
  },
  {
    chainId: SOLANA_MAINNET_CHAIN_ID,
    family: "solana",
    name: "Solana",
    displayName: "Solana",
    nativeCurrency: {
      name: "Solana",
      symbol: "SOL",
      decimals: 9,
    },
    // Public mainnet-beta RPC. Non-JSON-RPC-EVM; the Solana adapter builds a
    // Connection from this URL. Configurable via the chain config in
    // src/chains/solana/solana.config.ts.
    rpcUrl: "https://api.mainnet-beta.solana.com",
    blockExplorerUrl: "https://solscan.io",
    isTestnet: false,
    standardLabel: "SPL",
  },
  {
    chainId: SOLANA_DEVNET_CHAIN_ID,
    family: "solana",
    name: "Solana Devnet",
    displayName: "Solana Devnet",
    nativeCurrency: {
      name: "Solana",
      symbol: "SOL",
      decimals: 9,
    },
    rpcUrl: "https://api.devnet.solana.com",
    blockExplorerUrl: "https://solscan.io",
    isTestnet: true,
    standardLabel: "SPL Devnet",
  },
  {
    chainId: TON_MAINNET_CHAIN_ID,
    family: "ton",
    // NETWORK identity stays "TON" (name/displayName, chip, selector). Only the
    // native ASSET was rebranded Toncoin → Gram (symbol TON → GRAM) below.
    name: "TON",
    displayName: "TON",
    nativeCurrency: {
      name: "Gram",
      symbol: "GRAM",
      decimals: 9,
    },
    // TON uses an HTTP API rather than JSON-RPC and is never reached through
    // this rpcUrl (the TON adapter routes every call through the Simpl API TON
    // proxy in ton.config.ts). Kept here for display/parity only and pointed at
    // the proxy so no direct provider URL ships in the bundle.
    rpcUrl: "https://api.getsimpl.io/v1/ton",
    blockExplorerUrl: "https://tonviewer.com",
    isTestnet: false,
    standardLabel: "TON",
  },
  {
    chainId: SEPOLIA_CHAIN_ID,
    family: "evm",
    name: "Sepolia",
    displayName: "Sepolia",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    blockExplorerUrl: "https://sepolia.etherscan.io",
    isTestnet: true,
    standardLabel: "ERC-20 Testnet",
  },
];

// Token standard label for a chain, with an "EVM" fallback for chains that
// haven't declared one. Display metadata only.
export function getNetworkStandardLabel(chainId: number): string {
  return getChainById(chainId)?.standardLabel ?? "EVM";
}

// Canonical user-facing network name, used everywhere a network is labelled so
// naming stays consistent (e.g. "BNB Chain", "Ethereum"). Falls back to a
// generic "Chain <id>" for unknown chains.
export function getNetworkDisplayName(chainId: number): string {
  return getChainById(chainId)?.displayName ?? `Chain ${chainId}`;
}

// Shorter labels for space-constrained surfaces (e.g. the HomePage top-bar
// network chip) where the full display name would clip. Only names that are too
// long for a compact chip are shortened; everything else keeps its display name.
// The full name stays available via title/aria-label at the call site.
const COMPACT_NETWORK_NAMES: Record<number, string> = {
  [BITCOIN_MAINNET_CHAIN_ID]: "BTC",
  [BITCOIN_TESTNET_CHAIN_ID]: "BTC Testnet",
  [SOLANA_DEVNET_CHAIN_ID]: "SOL Devnet",
};

export function getCompactNetworkName(chainId: number): string {
  return COMPACT_NETWORK_NAMES[chainId] ?? getNetworkDisplayName(chainId);
}

// Address/transaction family for a chain. Unknown chains default to "evm" so
// any legacy/custom EVM chain keeps working as before.
export function getChainFamily(chainId: number): ChainFamily {
  return getChainById(chainId)?.family ?? "evm";
}

// True when the chain routes through the TRON adapter instead of EVM plumbing.
export function isTronChainId(chainId: number): boolean {
  return getChainFamily(chainId) === "tron";
}

// True when the chain routes through the UTXO Bitcoin adapter.
export function isBitcoinChainId(chainId: number): boolean {
  return getChainFamily(chainId) === "bitcoin";
}

// True when the chain routes through the Ed25519 Solana adapter.
export function isSolanaChainId(chainId: number): boolean {
  return getChainFamily(chainId) === "solana";
}

// True when the chain routes through the Ed25519 TON adapter.
export function isTonChainId(chainId: number): boolean {
  return getChainFamily(chainId) === "ton";
}

export function getChainById(chainId: number): ChainConfig | null {
  return DEFAULT_CHAINS.find((chain) => chain.chainId === chainId) ?? null;
}

export function getRequiredChainById(chainId: number): ChainConfig {
  const chain = getChainById(chainId);

  if (!chain) {
    throw new Error(`Unsupported chain id: ${chainId}`);
  }

  return chain;
}