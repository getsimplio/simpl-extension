// src/chains/ton/ton.derivation.ts
//
// BIP-44 Ed25519 (SLIP-0010) HD derivation for TON. Like Solana (and unlike
// EVM/TRON/Bitcoin, which are secp256k1), TON keys are Ed25519. We derive a
// 32-byte Ed25519 seed from the BIP-39 seed produced by @scure/bip39 (already
// shipped in the wallet), build a TON Ed25519 key pair from it, and compute the
// wallet *contract* address — TON wallets are smart contracts, so the address is
// the contract address of the standard wallet (v4R2) holding that public key.
//
// We use the official @ton SDK to compute the address (@ton/ton's
// WalletContractV4 carries the audited wallet code internally and derives the
// address locally, with no network access). Hardcoding the contract code BoC by
// hand would risk an incorrect address — and an incorrect receive address means
// lost funds — so we deliberately rely on the SDK here.
//
// SECURITY: the public derivation entry points (deriveTonAccountFromMnemonic,
// deriveTonAddress) never return secret key material. The signing entry point
// (deriveTonKeyPairFromMnemonic) returns an Ed25519 key pair and is for the
// wallet/background service layer ONLY — its secretKey must never reach the
// React UI, logs, activity or errors, and is held transiently at signing time.

import { mnemonicToSeedSync } from "@scure/bip39";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { keyPairFromSeed, type KeyPair } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";
import { normalizeMnemonicForDerivation } from "../../core/accounts/derivation";
import { getTonDerivationPath } from "./ton.address";
import type { DerivedTonAccount } from "./ton.types";

// SLIP-0010 Ed25519 HD derivation over @noble/hashes (pure JS, no Node crypto
// deps) so the bundle stays browser-clean. TON paths are fully hardened
// (m/44'/607'/i'/0'), the only mode SLIP-0010 supports for Ed25519. This mirrors
// the Solana adapter's implementation.

const ED25519_SEED_KEY = utf8ToBytes("ed25519 seed");
const HARDENED_OFFSET = 0x80000000;

type HdNode = { key: Uint8Array; chainCode: Uint8Array };

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data);
}

function masterKeyFromSeed(seed: Uint8Array): HdNode {
  const I = hmacSha512(ED25519_SEED_KEY, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function deriveHardenedChild(node: HdNode, index: number): HdNode {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(node.key, 1);

  const hardened = (index + HARDENED_OFFSET) >>> 0;
  const view = new DataView(data.buffer);
  view.setUint32(33, hardened, false); // big-endian

  const I = hmacSha512(node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

// Walk a fully-hardened path (e.g. "m/44'/607'/0'/0'") from the seed and return
// the 32-byte Ed25519 seed at that node.
function deriveEd25519Seed(path: string, seed: Uint8Array): Uint8Array {
  const segments = path
    .split("/")
    .slice(1) // drop the leading "m"
    .map((segment) => {
      const hardened = segment.endsWith("'") || segment.endsWith("h");
      const value = Number.parseInt(segment.replace(/['h]$/, ""), 10);
      if (!Number.isInteger(value) || value < 0 || !hardened) {
        throw new Error(`Invalid hardened path segment: ${segment}`);
      }
      return value;
    });

  let node = masterKeyFromSeed(seed);
  for (const index of segments) {
    node = deriveHardenedChild(node, index);
  }

  return node.key;
}

// Compute the standard (v4R2) TON wallet contract address for an Ed25519 public
// key on the masterchain workchain 0. Returns the user-friendly, non-bounceable
// mainnet form (UQ…), which is the convention for receive addresses.
function walletAddressForPublicKey(publicKey: Buffer): string {
  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  return wallet.address.toString({ urlSafe: true, bounceable: false });
}

// Derive the TON account (public address + public key) for `accountIndex` from a
// mnemonic. Public-only: no secret key is returned or held beyond this call.
export function deriveTonAccountFromMnemonic(
  mnemonic: string,
  accountIndex: number,
): DerivedTonAccount {
  const normalized = normalizeMnemonicForDerivation(mnemonic);
  const seed = mnemonicToSeedSync(normalized);
  const derivationPath = getTonDerivationPath(accountIndex);

  const ed25519Seed = deriveEd25519Seed(derivationPath, seed);
  const keyPair = keyPairFromSeed(Buffer.from(ed25519Seed));
  const address = walletAddressForPublicKey(keyPair.publicKey);

  return {
    address,
    publicKey: keyPair.publicKey.toString("hex"),
    derivationPath,
  };
}

// Public-only view: just the user-friendly address. Used for the display/persist
// path so we never hold key material longer than needed.
export function deriveTonAddress(
  mnemonic: string,
  accountIndex: number,
): string {
  return deriveTonAccountFromMnemonic(mnemonic, accountIndex).address;
}

// Signing material for `accountIndex`: the Ed25519 key pair plus the wallet's
// user-friendly address. SERVICE-LAYER ONLY — the returned `keyPair.secretKey`
// is signing material and must never be exposed to the UI, logged or persisted.
export function deriveTonKeyPairFromMnemonic(
  mnemonic: string,
  accountIndex: number,
): { keyPair: KeyPair; address: string; derivationPath: string } {
  const normalized = normalizeMnemonicForDerivation(mnemonic);
  const seed = mnemonicToSeedSync(normalized);
  const derivationPath = getTonDerivationPath(accountIndex);

  const ed25519Seed = deriveEd25519Seed(derivationPath, seed);
  const keyPair = keyPairFromSeed(Buffer.from(ed25519Seed));
  const address = walletAddressForPublicKey(keyPair.publicKey);

  return { keyPair, address, derivationPath };
}
