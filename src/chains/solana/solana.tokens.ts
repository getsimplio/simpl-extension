// src/chains/solana/solana.tokens.ts
//
// SPL token loading. Reads the owner's parsed token accounts and returns a
// unified balance list compatible with the wallet's Home/Assets surfaces. Token
// metadata for a handful of popular mints is seeded below for nice labels/logos;
// it is NOT the source of truth — any other mint still shows up, falling back to
// a shortened mint as its symbol/name so the list never blanks or crashes.

import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { SolanaChainConfig } from "./solana.config";
import { isValidSolanaAddress } from "./solana.address";
import { formatTokenAmount } from "./solana.format";
import { solanaErrorFor } from "./solana.errors";
import { withSolanaRead } from "./solana.rpc";
import type { SolanaTokenBalance } from "./solana.types";

const isDev = Boolean((import.meta.env as { DEV?: boolean } | undefined)?.DEV);

// Dev-only diagnostics for background metadata enrichment. No-op in production.
// Never logs addresses' secret material — only the mint, names and status.
function metaDebug(message: string, detail?: Record<string, unknown>): void {
  if (isDev) console.debug(`[solana-meta] ${message}`, detail ?? {});
}

type KnownToken = {
  symbol: string;
  name: string;
  logoUrl: string | null;
};

// Seed metadata for popular mainnet SPL mints. Display-only; extend freely.
export const KNOWN_SPL_TOKENS: Record<string, KnownToken> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    name: "USD Coin",
    logoUrl: null,
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: "USDT",
    name: "Tether USD",
    logoUrl: null,
  },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
    symbol: "JUP",
    name: "Jupiter",
    logoUrl: null,
  },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
    symbol: "BONK",
    name: "Bonk",
    // Canonical BONK logo from its Metaplex off-chain metadata. AssetIcon falls
    // back to initials if this ever fails to load, so it's safe to seed here.
    logoUrl:
      "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
  },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: {
    symbol: "WIF",
    name: "dogwifhat",
    logoUrl: null,
  },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: {
    symbol: "PYTH",
    name: "Pyth Network",
    logoUrl: null,
  },
};

function shortenMint(mint: string): string {
  return mint.length <= 8 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// Map a mint to its display metadata, falling back to a shortened mint when the
// mint is unknown (never throws, never returns empty labels).
export function resolveTokenMetadata(mint: string): {
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
} {
  const known = KNOWN_SPL_TOKENS[mint];

  if (known) {
    return { ...known, isVerified: true };
  }

  const short = shortenMint(mint);
  return { symbol: short, name: short, logoUrl: null, isVerified: false };
}

// Metaplex Token Metadata program — the on-chain home of name/symbol/uri for
// most SPL tokens. We derive the metadata PDA and parse the account ourselves
// (a tiny borsh string reader) to avoid pulling in the heavy Metaplex SDK.
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// PDA seeds: ["metadata", metadataProgramId, mint]. Uint8Array seeds avoid any
// dependency on a Buffer polyfill.
function deriveMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("metadata"),
      METAPLEX_METADATA_PROGRAM_ID.toBytes(),
      mint.toBytes(),
    ],
    METAPLEX_METADATA_PROGRAM_ID,
  );
  return pda;
}

type MetaplexOnChain = { name: string; symbol: string; uri: string };

// Parse a Metaplex Metadata account. Layout (prefix): key(1) + updateAuthority(32)
// + mint(32), then the Data struct's first three borsh strings: name, symbol,
// uri — each a u32 little-endian length followed by UTF-8 bytes, padded with
// null bytes which we strip. Returns null on any malformed/out-of-range read.
function parseMetaplexMetadata(data: Uint8Array): MetaplexOnChain | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 1 + 32 + 32;

    const readString = (): string => {
      if (offset + 4 > data.length) throw new Error("oob");
      const len = view.getUint32(offset, true);
      offset += 4;
      // Guard against corrupt/huge lengths (max on-chain uri is 200 bytes).
      if (len > 4096 || offset + len > data.length) throw new Error("oob");
      const bytes = data.subarray(offset, offset + len);
      offset += len;
      return new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
    };

    const name = readString();
    const symbol = readString();
    const uri = readString();
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

// Read + parse the Metaplex metadata account for a mint. Returns null when there
// is no metadata account (many tokens) or the account can't be parsed. Fills the
// dev diagnostic with the PDA, whether the account existed, and the parse result
// / failure reason so an unresolved token is always explainable.
async function loadMetaplexOnChainMetadata(
  config: SolanaChainConfig,
  mint: PublicKey,
  diag: SolanaMetaDiag,
): Promise<MetaplexOnChain | null> {
  const pda = deriveMetadataPda(mint);
  diag.metaplex.pda = pda.toBase58();
  // Metadata is best-effort and must never hold up the preview, so use a shorter
  // per-endpoint deadline than the critical mint read — a dead endpoint here
  // fails fast and the preview still loads with the safe name/symbol fallback.
  const account = await withSolanaRead(
    config,
    (connection) => connection.getAccountInfo(pda),
    { timeoutMs: 4000 },
  );
  if (!account || !account.data) {
    diag.metaplex.accountExists = false;
    diag.metaplex.reason = "account missing";
    return null;
  }
  diag.metaplex.accountExists = true;
  const bytes =
    account.data instanceof Uint8Array
      ? account.data
      : new Uint8Array(account.data as ArrayBufferLike);
  const parsed = parseMetaplexMetadata(bytes);
  if (!parsed) {
    diag.metaplex.reason = "parse failed";
    return null;
  }
  diag.metaplex.parsed = { name: parsed.name, symbol: parsed.symbol, uri: parsed.uri };
  return parsed;
}

// IPFS gateways tried in order. The first that returns valid JSON / a loadable
// image wins — important because any single gateway (e.g. nft.storage) can be
// deprecated, rate-limited or down.
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

const UNSAFE_URI_SCHEMES = /^(javascript|data|file|blob):/iu;

// Extract the "<cid>/<path>" portion from any IPFS-style URL: ipfs:// , a
// path-style gateway (…/ipfs/<cid>/…), or a subdomain-style gateway
// (https://<cid>.ipfs.<host>/…). Returns null for non-IPFS URLs.
function extractIpfsPath(url: string): string | null {
  const u = url.trim();
  if (u.startsWith("ipfs://")) {
    return u.slice("ipfs://".length).replace(/^ipfs\//u, "");
  }
  const pathStyle = u.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/iu);
  if (pathStyle) return pathStyle[1];
  const subdomainStyle = u.match(
    /^https?:\/\/([a-z0-9]+)\.ipfs\.[^/]+(\/.*)?$/iu,
  );
  if (subdomainStyle) return `${subdomainStyle[1]}${subdomainStyle[2] ?? ""}`;
  return null;
}

// Gateway candidate URLs for an IPFS "<cid>/<path>".
function getIpfsGatewayCandidates(ipfsPath: string): string[] {
  const clean = ipfsPath.replace(/^\/+/u, "");
  return IPFS_GATEWAYS.map((gateway) => gateway + clean);
}

// Turn a metadata/image URI into an ordered list of safe https candidate URLs:
//   ipfs:// or any IPFS gateway URL → every gateway candidate
//   ar://                           → arweave.net
//   https:// / http://              → as-is (still expanded if it's IPFS)
//   javascript:/data:/file:/blob:   → [] (rejected)
function normalizeMetadataUri(uri: string): string[] {
  const u = uri.trim();
  if (!u || UNSAFE_URI_SCHEMES.test(u)) return [];

  const ipfsPath = extractIpfsPath(u);
  if (ipfsPath) return getIpfsGatewayCandidates(ipfsPath);

  if (u.startsWith("ar://")) {
    return [`https://arweave.net/${u.slice("ar://".length)}`];
  }
  if (u.startsWith("https://") || u.startsWith("http://")) return [u];
  return [];
}

type OffChainMetadata = {
  name?: unknown;
  symbol?: unknown;
  image?: unknown;
  image_url?: unknown;
  logoURI?: unknown;
  logo?: unknown;
};

// Fetch the first candidate URL that returns parseable JSON, within a per-try
// timeout. JSON only — no scripts execute; only string fields are read later.
// Returns the JSON plus the URL it came from (to resolve relative image paths).
async function fetchJsonWithTimeout(
  urls: string[],
  timeoutMs = 6000,
): Promise<{ json: OffChainMetadata; baseUrl: string } | null> {
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      const json = (await response.json()) as unknown;
      if (json && typeof json === "object") {
        return { json: json as OffChainMetadata, baseUrl: url };
      }
    } catch {
      // Try the next gateway candidate.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

// Build ordered, safe candidate URLs for a token image. Handles ipfs/ar/https
// (with gateway fallbacks) and relative paths resolved against the JSON's URL.
function resolveTokenImageUrl(rawImage: string, baseJsonUrl: string): string[] {
  const image = rawImage.trim();
  if (!image || UNSAFE_URI_SCHEMES.test(image)) return [];

  // Absolute / scheme'd URIs (incl. ipfs:// , ar://) go through the normalizer.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(image)) {
    return normalizeMetadataUri(image);
  }

  // Relative path — resolve against the JSON URL (a safe https base).
  try {
    return [new URL(image, baseJsonUrl).toString()];
  } catch {
    return [];
  }
}

const IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

// Return the first candidate URL that actually serves an image. Tries HEAD then
// GET (some gateways reject HEAD). Accepts 200 with an image content-type, or
// 200 with a missing content-type. Moves to the next gateway on any failure.
async function validateImageUrl(
  urls: string[],
  timeoutMs = 5000,
): Promise<string | null> {
  for (const url of urls) {
    for (const method of ["HEAD", "GET"] as const) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { method, signal: controller.signal });
        if (!response.ok) continue;
        const contentType = (response.headers.get("content-type") ?? "")
          .toLowerCase()
          .split(";")[0]
          .trim();
        if (!contentType || IMAGE_CONTENT_TYPES.has(contentType)) {
          return url;
        }
        // 200 but a non-image type → not an image; skip to the next candidate.
        break;
      } catch {
        // HEAD may be unsupported — fall through to GET, then next candidate.
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return null;
}

export type ResolvedSplMetadata = {
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
};

// Token-2022 program — newer mints may carry their metadata inline via the SPL
// Token Metadata extension instead of a classic Metaplex account. web3.js's
// parsed account info surfaces those extensions under info.extensions, so we can
// read name/symbol/uri without any extra dependency or manual TLV parsing.
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

type ParsedMintExtension = {
  extension?: string;
  state?: Record<string, unknown>;
};

// Read a Token-2022 mint's inline metadata extension (name/symbol/uri), if any.
// Lightweight: one bounded parsed-account read, reusing the same RPC the critical
// preview already uses. Returns null for classic SPL mints, mints without the
// metadata extension, or a metadata-pointer-only mint (logged as unsupported).
async function loadToken2022Metadata(
  config: SolanaChainConfig,
  mintKey: PublicKey,
  diag: SolanaMetaDiag,
): Promise<MetaplexOnChain | null> {
  diag.token2022.attempted = true;
  const info = await withSolanaRead(
    config,
    (connection) => connection.getParsedAccountInfo(mintKey),
    { timeoutMs: 4000 },
  );

  const value = info.value;
  diag.token2022.owner = value?.owner?.toBase58() ?? null;
  diag.token2022.isToken2022 = diag.token2022.owner === TOKEN_2022_PROGRAM_ID;

  const data = value?.data;
  const parsedInfo =
    data && typeof data === "object" && "parsed" in data
      ? (data as { parsed?: { info?: { extensions?: unknown } } }).parsed?.info
      : null;
  const extensions = Array.isArray(parsedInfo?.extensions)
    ? (parsedInfo?.extensions as ParsedMintExtension[])
    : null;

  if (!extensions) {
    diag.token2022.result = "no-extensions";
    return null;
  }

  const tokenMetadata = extensions.find((e) => e.extension === "tokenMetadata");
  const pointer = extensions.find((e) => e.extension === "metadataPointer");
  diag.token2022.hasPointer = Boolean(pointer);
  diag.token2022.hasInlineMetadata = Boolean(tokenMetadata?.state);

  if (tokenMetadata?.state) {
    const state = tokenMetadata.state;
    const result: MetaplexOnChain = {
      name: asNonEmptyString(state.name) ?? "",
      symbol: asNonEmptyString(state.symbol) ?? "",
      uri: asNonEmptyString(state.uri) ?? "",
    };
    diag.token2022.result = "inline-metadata";
    return result;
  }

  // A pointer to a separate metadata account would need raw TLV parsing — out of
  // scope for this lightweight pass. Diagnose and fall through to fallback.
  diag.token2022.result = pointer ? "pointer-only-unsupported" : "no-metadata";
  return null;
}

// Final metadata source for diagnostics — which stage produced the name/symbol.
type SolanaMetaSource =
  | "known"
  | "metaplex"
  | "token2022"
  | "offchain"
  | "fallback";

// Dev-only diagnostic record for one mint's metadata resolution. Built always
// (cheap), logged only in DEV via metaDebug. Never shown in production UI.
type SolanaMetaDiag = {
  mint: string;
  knownHit: boolean;
  metaplex: {
    pda: string | null;
    accountExists: boolean;
    parsed: { name: string; symbol: string; uri: string } | null;
    reason: string | null;
  };
  token2022: {
    attempted: boolean;
    owner: string | null;
    isToken2022: boolean;
    hasPointer: boolean;
    hasInlineMetadata: boolean;
    result: string | null;
  };
  uriCandidates: string[];
  jsonFetch: { ok: boolean; url: string | null };
  imageCandidates: string[];
  image: { ok: boolean; url: string | null };
  finalSource: SolanaMetaSource;
};

function newMetaDiag(mint: string): SolanaMetaDiag {
  return {
    mint,
    knownHit: false,
    metaplex: { pda: null, accountExists: false, parsed: null, reason: null },
    token2022: {
      attempted: false,
      owner: null,
      isToken2022: false,
      hasPointer: false,
      hasInlineMetadata: false,
      result: null,
    },
    uriCandidates: [],
    jsonFetch: { ok: false, url: null },
    imageCandidates: [],
    image: { ok: false, url: null },
    finalSource: "fallback",
  };
}

// Resolve display metadata for a mint, in priority order:
//   1. Local known list (resolveTokenMetadata) — verified tokens win outright.
//   2. Metaplex on-chain name/symbol/uri (classic metadata account).
//   3. Token-2022 inline metadata extension (newer mints w/o a Metaplex account).
//   4. Off-chain JSON for any URI found (name/symbol fallback + image/logo,
//      multi-gateway).
//   5. Safe fallback: shortened mint + "Solana Token" + no logo.
// The logo URL is validated (it must actually serve an image) before being
// returned, so callers can save/use it directly. Never throws — any metadata
// failure degrades to the next source / fallback. A full dev-only diagnostic is
// logged so an unresolved token always has a clear reason.
async function resolveSplTokenMetadata(
  config: SolanaChainConfig,
  mintKey: PublicKey,
  mint: string,
): Promise<ResolvedSplMetadata> {
  const diag = newMetaDiag(mint);

  const known = resolveTokenMetadata(mint);
  if (known.isVerified) {
    diag.knownHit = true;
    diag.finalSource = "known";
    metaDebug("resolution complete", diag);
    return {
      symbol: known.symbol,
      name: known.name,
      logoUrl: known.logoUrl,
      isVerified: true,
    };
  }

  // Start from the safe fallback; upgrade fields as real metadata is found.
  let symbol = shortenMint(mint);
  let name = "Solana Token";
  let logoUrl: string | null = null;
  let haveName = false;
  let haveSymbol = false;
  let uri = "";
  let source: SolanaMetaSource = "fallback";

  try {
    // 2. Classic Metaplex metadata account.
    const onChain = await loadMetaplexOnChainMetadata(config, mintKey, diag);
    if (onChain) {
      if (onChain.name) {
        name = onChain.name;
        haveName = true;
      }
      if (onChain.symbol) {
        symbol = onChain.symbol;
        haveSymbol = true;
      }
      if (onChain.uri) uri = onChain.uri;
      if (haveName || haveSymbol) source = "metaplex";
    }

    // 3. Token-2022 inline metadata — only when Metaplex gave us no name/symbol.
    if (!haveName && !haveSymbol) {
      const t22 = await loadToken2022Metadata(config, mintKey, diag);
      if (t22) {
        if (t22.name) {
          name = t22.name;
          haveName = true;
        }
        if (t22.symbol) {
          symbol = t22.symbol;
          haveSymbol = true;
        }
        if (!uri && t22.uri) uri = t22.uri;
        if (haveName || haveSymbol) source = "token2022";
      }
    }

    // 4. Off-chain JSON for any URI found — fills missing name/symbol and the
    //    image/logo. The on-chain uri may itself be a dead IPFS gateway, so it's
    //    expanded to all gateway candidates and the first that returns JSON wins.
    if (uri) {
      const candidates = normalizeMetadataUri(uri);
      diag.uriCandidates = candidates;
      const fetched = await fetchJsonWithTimeout(candidates);
      diag.jsonFetch = { ok: Boolean(fetched), url: fetched?.baseUrl ?? null };
      if (fetched) {
        const { json, baseUrl } = fetched;

        if (!haveName) {
          const offName = asNonEmptyString(json.name);
          if (offName) {
            name = offName;
            haveName = true;
            if (source === "fallback") source = "offchain";
          }
        }
        if (!haveSymbol) {
          const offSymbol = asNonEmptyString(json.symbol);
          if (offSymbol) {
            symbol = offSymbol;
            haveSymbol = true;
            if (source === "fallback") source = "offchain";
          }
        }

        // Image: accept the common field names, expand to gateway candidates,
        // and keep only a URL that actually serves an image.
        const rawImage =
          asNonEmptyString(json.image) ??
          asNonEmptyString(json.image_url) ??
          asNonEmptyString(json.logoURI) ??
          asNonEmptyString(json.logo);
        if (rawImage) {
          const imageCandidates = resolveTokenImageUrl(rawImage, baseUrl);
          diag.imageCandidates = imageCandidates;
          logoUrl = await validateImageUrl(imageCandidates);
          diag.image = { ok: Boolean(logoUrl), url: logoUrl };
        }
      }
    }
  } catch (error) {
    // Metadata is best-effort — never block the preview on it.
    console.debug("Solana metadata resolution failed (using fallback):", error);
  }

  diag.finalSource = source;
  metaDebug("resolution complete", diag);

  return { symbol, name, logoUrl, isVerified: false };
}

export type SplTokenPreview = {
  mint: string;
  decimals: number;
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
  // Owner's balance for this mint. 0 when the owner has no associated token
  // account (never throws / crashes for a missing account).
  rawAmount: bigint;
  formatted: string;
  // On-chain total supply (base units) when the RPC returns it, else null.
  supply: string | null;
};

// Read the mint account and extract decimals (+ supply). Throws when the address
// isn't a real SPL mint — this is the only critical, import-blocking read.
async function readSplMintInfo(
  config: SolanaChainConfig,
  mintKey: PublicKey,
): Promise<{ decimals: number; supply: string | null }> {
  const mintInfo = await withSolanaRead(config, (connection) =>
    connection.getParsedAccountInfo(mintKey),
  );

  const data = mintInfo.value?.data;
  const parsed =
    data && typeof data === "object" && "parsed" in data
      ? (
          data as {
            parsed?: {
              type?: string;
              info?: { decimals?: number; supply?: string };
            };
          }
        ).parsed
      : null;

  if (
    !parsed ||
    parsed.type !== "mint" ||
    typeof parsed.info?.decimals !== "number"
  ) {
    throw new Error(
      `No SPL token mint at this address on ${config.name}. Check the mint address and the selected network.`,
    );
  }

  return {
    decimals: parsed.info.decimals,
    supply: typeof parsed.info.supply === "string" ? parsed.info.supply : null,
  };
}

// Owner balance for this mint. Missing owner / token account → 0, never throws:
// a balance read failure must not block the preview.
async function readOwnerSplBalance(
  config: SolanaChainConfig,
  ownerAddress: string | null,
  mintKey: PublicKey,
): Promise<bigint> {
  if (!ownerAddress || !isValidSolanaAddress(ownerAddress)) return 0n;
  try {
    const owner = new PublicKey(ownerAddress);
    const accounts = await withSolanaRead(config, (connection) =>
      connection.getParsedTokenAccountsByOwner(owner, { mint: mintKey }),
    );
    let rawAmount = 0n;
    for (const entry of accounts.value) {
      const amount = readParsedInfo(entry)?.tokenAmount?.amount;
      if (amount != null) rawAmount += BigInt(amount);
    }
    return rawAmount;
  } catch (error) {
    console.debug("Solana SPL balance read failed (defaulting to 0):", error);
    return 0n;
  }
}

// A critical preview plus a flag telling the caller whether its name/symbol/logo
// are already final (a verified known token) or still need background enrichment.
export type SplTokenCriticalPreview = SplTokenPreview & {
  // true → metadata is already final (known list); no Stage-2 call is needed.
  metadataResolved: boolean;
};

// Stage 1 — CRITICAL preview, returned fast. Validates the mint, proves it's a
// real SPL mint (decimals/supply), reads the owner balance, and fills metadata
// ONLY from the local known list (instant, no network metadata). Unknown mints
// get the safe fallback (shortened mint + "Solana Token" + no logo) and are
// enriched separately by loadSplTokenMetadata. Reads go through withSolanaRead,
// so an RPC failure throws a normalized Solana error. The mint string is used
// verbatim (base58 is case-sensitive and must not be lowercased).
export async function loadSplTokenPreviewCritical(
  config: SolanaChainConfig,
  ownerAddress: string | null,
  mint: string,
): Promise<SplTokenCriticalPreview> {
  const trimmedMint = mint.trim();

  if (!isValidSolanaAddress(trimmedMint)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  const mintKey = new PublicKey(trimmedMint);

  const { decimals, supply } = await readSplMintInfo(config, mintKey);

  // Metadata from the LOCAL known list only — instant, no network. Unknown mints
  // keep the safe fallback until Stage-2 enrichment upgrades them.
  const known = resolveTokenMetadata(trimmedMint);
  const symbol = known.isVerified ? known.symbol : shortenMint(trimmedMint);
  const name = known.isVerified ? known.name : "Solana Token";
  const logoUrl = known.isVerified ? known.logoUrl : null;

  const rawAmount = await readOwnerSplBalance(config, ownerAddress, mintKey);

  return {
    mint: trimmedMint,
    decimals,
    symbol,
    name,
    logoUrl,
    isVerified: known.isVerified,
    rawAmount,
    formatted: formatTokenAmount(rawAmount, decimals),
    supply,
    metadataResolved: known.isVerified,
  };
}

// Overall background budget for Stage-2 enrichment. Each sub-read already has its
// own short per-endpoint / per-gateway timeout; this is the hard ceiling so the
// whole enrichment can never run forever even if every gateway stalls.
const METADATA_BUDGET_MS = 12_000;

// Stage 2 — BEST-EFFORT background metadata enrichment for a mint already shown
// in a Stage-1 preview. Resolves Metaplex name/symbol, off-chain JSON and a
// validated logo URL, bounded by an overall budget. Never throws and never
// blocks import — returns the safe fallback metadata when nothing better is
// found (so the caller can merge unconditionally).
export async function loadSplTokenMetadata(
  config: SolanaChainConfig,
  mint: string,
  options?: { timeoutMs?: number },
): Promise<ResolvedSplMetadata> {
  const trimmedMint = mint.trim();
  const fallback: ResolvedSplMetadata = {
    symbol: shortenMint(trimmedMint),
    name: "Solana Token",
    logoUrl: null,
    isVerified: false,
  };

  if (!isValidSolanaAddress(trimmedMint)) return fallback;

  const mintKey = new PublicKey(trimmedMint);
  const budgetMs = options?.timeoutMs ?? METADATA_BUDGET_MS;

  metaDebug("enrichment started", { mint: trimmedMint, budgetMs });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveSplTokenMetadata(config, mintKey, trimmedMint),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Solana metadata budget exceeded")),
          budgetMs,
        );
      }),
    ]);
  } catch (error) {
    metaDebug("enrichment timed out / failed (using fallback)", {
      mint: trimmedMint,
      error: String(error),
    });
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Combined single-shot preview (critical + enrichment), kept for back-compat and
// non-UI callers that want one resolved object. The Add Token screen uses the
// two-stage API (critical then background metadata) for a snappier UI instead.
export async function loadSplTokenPreview(
  config: SolanaChainConfig,
  ownerAddress: string | null,
  mint: string,
): Promise<SplTokenPreview> {
  const critical = await loadSplTokenPreviewCritical(config, ownerAddress, mint);
  const {
    metadataResolved: _metadataResolved,
    ...preview
  } = critical;

  if (critical.metadataResolved) return preview;

  const metadata = await loadSplTokenMetadata(config, critical.mint);
  return {
    ...preview,
    symbol: metadata.symbol,
    name: metadata.name,
    logoUrl: metadata.logoUrl,
    isVerified: metadata.isVerified,
  };
}

type ParsedTokenAccountInfo = {
  mint?: string;
  tokenAmount?: {
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
  };
};

function readParsedInfo(account: unknown): ParsedTokenAccountInfo | null {
  const parsed = (
    account as {
      account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } };
    }
  )?.account?.data?.parsed?.info;

  return parsed ?? null;
}

// Load the owner's SPL token balances. By default only positive balances are
// returned (the common wallet view); pass includeZero to keep empty accounts.
// Reads across the config's endpoints with fallback (solana.rpc).
export async function getSplTokenBalances(
  address: string,
  config: SolanaChainConfig,
  options: { includeZero?: boolean } = {},
): Promise<SolanaTokenBalance[]> {
  if (!isValidSolanaAddress(address)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  const owner = new PublicKey(address);

  const response = await withSolanaRead(config, (connection) =>
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
  );

  const balances: SolanaTokenBalance[] = [];

  for (const entry of response.value) {
    const info = readParsedInfo(entry);
    const mint = info?.mint;
    const amountRaw = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;

    if (!mint || amountRaw == null || decimals == null) {
      continue;
    }

    const rawAmount = BigInt(amountRaw);

    if (!options.includeZero && rawAmount <= 0n) {
      continue;
    }

    const metadata = resolveTokenMetadata(mint);

    balances.push({
      mint,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals,
      rawAmount,
      formatted: formatTokenAmount(rawAmount, decimals),
      logoUrl: metadata.logoUrl,
      isVerified: metadata.isVerified,
    });
  }

  return balances;
}
