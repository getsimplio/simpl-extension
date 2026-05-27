# SIMPLE — Design System

> Control your assets without the noise.

SIMPLE is a non-custodial EVM wallet — a daily-use utility for managing assets across Ethereum-compatible chains. It ships as a Chrome extension, a web dashboard, and (soon) a mobile app.

This design system was built **from zero** for a full rebrand. There is no prior codebase, brand asset library, or design system to inherit from. Everything here is an opinionated starting point, ready for iteration.

---

## Sources & inputs

- **Brand brief** — provided by the team; full text in chat history. Key constraints:
  - Visual references: Apple Wallet, iOS Settings, Linear, Stripe Dashboard, hardware wallets, Swiss typography, Japanese minimalism, industrial product design
  - Hard avoids: purple gradients, neon crypto, DeFi casino style, mascots, 3D coins, glassmorphism, noisy dashboards
  - Primary surface: Chrome extension popup, **380 × 600**
  - Personality: minimal, precise, secure, calm, reliable, premium, utility-first
- No Figma file, GitHub repo, or codebase was attached. If they exist, please re-attach via the Import menu so this system can be reconciled.

---

## What's in here

```
colors_and_type.css   ── Foundational CSS variables for both products
assets/               ── Logos (4 explorations), wordmark, app icon, favicon
preview/              ── 19 design-system preview cards (registered)
ui_kits/
  extension/          ── Chrome extension popup, 9 screens, click-thru
  web/                ── Web dashboard preview
  mobile/             ── Mobile preview (iOS frames, 3 screens)
SKILL.md              ── Agent SKILL entrypoint, cross-compatible with Claude Code
README.md             ── This file
```

---

## CONTENT FUNDAMENTALS

### Voice
**Calm. Direct. Mechanical when it counts.** SIMPLE talks to people who are about to sign a transaction worth real money. We don't joke around them, we don't oversell. We say what is happening, and we let them act.

We are **the wallet, not the chain**. We name dApps, networks, and protocols by their real names — never invented mascot terms. We don't say "ape in", "diamond hands", "gm", "wagmi", or "🚀".

### Person & address
- **You** (second person) — never "we believe" except in legal copy
- Treat the user as the operator of their own keys. Phrase actions in their voice: "Sign & send", not "Submit transaction"
- Active voice: "Sign to authorize spend", not "Spend will be authorized"

### Casing
- **Sentence case everywhere**: buttons, headings, table headers, menu items
- **ALL CAPS reserved for**: overline labels (TOTAL BALANCE, RECENT, GAS · ETHEREUM) and `data-screen-label` overlays. Letter-spaced 0.08em.
- **Acronyms**: ETH, USDC, NFT, EVM, dApp (lowercase d), L2 — never expand on first use; users know them.

### Numbers, units, addresses
- **Tabular figures always** on balances and tables. Use `font-feature-settings: 'tnum' on`.
- **Truncate addresses** as `0x7d2F…9aE1` (6 chars + ellipsis + 4 chars) in lists; show full address only on Receive and Confirm screens.
- **Hashes**: `0x9c4f3a1bd827e0…` (first 14 chars + ellipsis) with an external-link icon.
- **Fiat**: always prefix `$`, two decimals, group by comma. Cents are de-emphasized in display sizes — `$12,847.<span color=ink-3>22</span>`.
- **Crypto amounts**: digits + space + symbol — `0.4218 ETH`, `5,210.00 USDC`. Up to 6 decimal places, trim trailing zeros except for stable tokens.
- **Gas**: `12 gwei` lowercase. Pair with USD estimate where possible: `$0.42 · 12 gwei`.

### Emoji & exclamation
**Never.** No emoji in product copy, no exclamation marks. The only exception is the unicode `●` dot used in status pills, and `↗` / `↘` arrows for indicators — these are typographic, not emoji.

### Examples — the SIMPLE tone

> ✅ **Yes**:
> "Review the details before signing. Once submitted to the network, this action cannot be reversed."
> "Only send Ethereum or ERC-20 tokens to this address. Other assets may be lost."
> "Wallet healthy · 4 / 4 checks passed"
> "Sign & send"
> "Reveal recovery phrase — requires password"

> ❌ **No**:
> ~~"You're all set! 🚀 Let's get you signing in no time!"~~
> ~~"Drop your seed phrase here to recover your bags"~~
> ~~"Approve" (too vague — say what you're approving)~~

### Error states
Errors describe **what failed and what to try**. Never blame the user.
- ✅ "Insufficient balance — top up or lower the amount"
- ✅ "Network unreachable — check your connection and retry"
- ❌ ~~"Error 502"~~ ~~"Something went wrong"~~

---

## VISUAL FOUNDATIONS

### Palette
**Paper & ink in light. Graphite in dark.** A monochrome system with one restrained accent (a hardware-LED green) for "secure" states.

Light canvas is a **warm bone (`#F6F5F1`)**, not stark white. Ink is a **soft near-black (`#14140F`)**, not pure black. This warmth is the single most important brand quality — it signals "calm utility" instead of "cheap fintech".

Dark canvas is a **true near-black (`#0B0B0A`)** with a slightly lifted surface (`#141413`). Stays neutral; no blue cast.

Signal colors are **all desaturated** by design — secure green is forest, not lime; danger is rust, not red; warn is mustard, not yellow. They appear sparingly, primarily as pill backgrounds and small dots. Hex values live in `colors_and_type.css`.

### Typography
- **UI**: IBM Plex Sans, 13–15px for body. Weight 400/500/600.
- **Display & wordmark**: IBM Plex Sans Condensed at 500/600 weight, letter-spacing tightened to -0.015em for headlines, opened to +0.04em for the wordmark.
- **Numerals & code**: IBM Plex Mono, with tabular figures on. Used universally for: balances, addresses, hashes, gas, prices, timestamps, version strings.

> ⚠️ **Substitution flag**: Plex is a working stand-in for premium options like Söhne, ABC Diatype, or Helvetica Neue Now. If a license budget exists, swap to one of those for a more distinctive feel. The Plex family is free, has a true matching mono, and reads excellent at small sizes — it's a strong substitute, not a placeholder.

### Spacing & rhythm
4-based scale: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64. Density is **tight** — the extension popup is dense by necessity (380×600), and the web dashboard follows the same rhythm rather than ballooning. List rows are 44–48px tall. Settings rows are 52px.

### Backgrounds
- **No gradients.** Solid fills only.
- **No imagery.** This is a utility tool; photography would feel marketing-adjacent.
- **No patterns or textures.** The QR code is the only "raster-looking" element, and that's functional.
- **Sunken backgrounds** (`bg-sunken`) for subtle grouping; **surface** (`bg-surface`) for cards.

### Borders, radii, elevation
- **Borders first, shadows reserved.** Almost every group is delimited by a 1px hairline border (`--line` or `--line-strong`).
- **Radii are small and sharp**: 4, 6, 8px. Never larger than 12px on rectangles. Pills are `--r-full` (999px) — reserved for status chips, account chips, and network chips.
- **Shadows** only on popovers and sheets (`--elev-popover`). Cards rest on borders.

### Animation
**Short, quiet, no bounce.** Default duration 160ms, easing `cubic-bezier(0.2, 0.7, 0.2, 1)`. Use for hover/focus state transitions, toggle thumbs, and tab indicators. **Never** for content entry (no fade-ins, no slide-ups on load). The interface should feel instant — frequent users open this many times per day.

### Hover & press
- **Hover**: background shifts one step lighter on light (`bg-hover`), one step lifted on dark.
- **Press / active**: shifts again to `bg-active`. No scale transform.
- **Focus**: border color goes to `--ink-1` (1px stronger). No glow, no halo.
- **Disabled**: opacity 0.4, pointer-events none.

### Transparency, blur, glass
**None.** No backdrop-filter blur. No translucent panels except the iOS native status bar (out of our control). This is intentional — glass effects compete for attention and look dated next to the rest of the system.

### Layout rules
- The extension popup has **two fixed bars**: top (account/network/menu) and bottom (4-tab nav). The middle scrolls.
- Page screens (Send, Receive, Settings detail) replace the top bar with a back+title header. They keep the bottom nav when contextual, drop it when modal.
- The web dashboard uses a **248px fixed sidebar** + scrolling main. Tables sit on full-width cards with internal padding.
- Cards are stacked, not nested. Maximum 2 levels of card depth anywhere.

### Iconography
Imagery is replaced by **iconography**. See ICONOGRAPHY section below.

---

## ICONOGRAPHY

### System
**Lucide** at **1.5px stroke weight**, loaded from `https://unpkg.com/lucide@latest/dist/umd/lucide.js`. Used universally across all surfaces (extension, web, mobile). Inserted as `<i data-lucide="name">` placeholders that get replaced with inline SVGs at runtime.

> ⚠️ **Substitution flag**: Lucide is a CDN substitute for a custom-designed icon set, which would normally exist in a mature brand. Lucide's thin geometric strokes match the Swiss/industrial aesthetic well, but a custom set would let us tune corner roundness, terminal style, and crypto-specific glyphs (network logos, token marks, hardware wallet icons). Recommend commissioning a set when budget allows.

### Sizes
- **22px** nominal in headers and standalone contexts
- **18px** in dense list rows and action buttons
- **16px** in inline buttons, settings rows
- **14px** in pills, dropdown markers, inline cues

### Use rules
- **Always stroke-only.** No filled icons in the system.
- **Always currentColor.** Icons inherit color from text — never colored explicitly except for status (secure / warn / danger).
- **Paired with text** by default in lists and buttons. Standalone icons only as icon-buttons (search, more, copy, scan), always with `aria-label`.

### Token & network logos
SIMPLE renders token logos as **monogram circles** (Ξ, $, ₿, U, A) on solid color backgrounds. This is intentional — official token logos vary wildly in quality and style and would shatter the system's consistency. Per-token brand colors are deeply desaturated to fit (USDC blue → `#2C5C8F`, UNI pink → `#B4426F`, etc.).

If product needs evolve toward "real logos", introduce a separate **TokenAvatar** component that switches between monogram and real-image based on a config flag.

### Emoji & unicode
- **No emoji.** Never.
- **Unicode allowed**: `●` (status dot), `↗` (external/up), `↘` (down), `…` (truncation ellipsis), `−` (minus, not hyphen, in negative balances).

---

## Index

| File | What |
|---|---|
| `colors_and_type.css` | All design tokens — colors (light + dark), type, spacing, radii, elevation, motion. Import this in any artifact. |
| `assets/logo-mark.svg` | Primary mark — notched-chip square |
| `assets/logo-mark-alt-{1,2,3}.svg` | Alternate explorations — SIM card, stacked S, vault dial |
| `assets/logo-wordmark.svg` | Wordmark lockup |
| `assets/app-icon.svg` | App icon (rounded square chrome) |
| `preview/*.html` | 19 design-system preview cards |
| `ui_kits/extension/index.html` | **Chrome extension UI kit** — 9 interactive screens (Welcome, Unlock, Home, Asset Detail, Send, Receive, Activity, Security, Settings + Accounts, Networks, Swap, Buy) |
| `ui_kits/web/index.html` | **Web dashboard preview** — sidebar + portfolio overview + chart + assets table + activity table |
| `ui_kits/mobile/index.html` | **Mobile preview** — 3 iOS screens (Home, Send, Activity) |
| `SKILL.md` | Agent skill manifest |
