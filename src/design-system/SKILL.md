---
name: simple-design
description: Use this skill to generate well-branded interfaces and assets for SIMPLE — a non-custodial EVM wallet for Chrome Extension, Web Dashboard, and mobile. Use for production work or throwaway prototypes/mocks/screens. Contains the full visual system (paper-and-ink monochrome palette, IBM Plex typography, hardware-LED accent), logo assets, design tokens in `colors_and_type.css`, and three reference UI kits (extension, web, mobile).
user-invocable: true
---

# SIMPLE — design skill

Read `README.md` first — it covers the brand voice, visual foundations, iconography rules, and the file index. Then dip into specifics on demand:

- **Tokens**: `colors_and_type.css` — import this in any HTML artifact you create. It defines all color, type, spacing, radius, elevation, and motion variables for both light and dark mode.
- **Logos**: `assets/logo-mark.svg`, `logo-wordmark.svg`, `app-icon.svg`. There are also three alternate marks (`-alt-1/2/3`) for exploration.
- **Components & screens**: read the three UI kits in `ui_kits/{extension, web, mobile}/`. The JSX files inside (`components.jsx`, `screens-1.jsx`, `screens-2.jsx`, `dashboard.jsx`, etc.) are pixel-accurate reference implementations — copy components and styles from them rather than reinventing.
- **Preview cards**: `preview/*.html` — one-purpose cards (buttons, pills, list rows, type specimens, etc.) you can lift wholesale for quick prototypes.

## Working rules

1. **Always import `colors_and_type.css`.** Never hand-write hex colors when a token exists. If you need a color the system doesn't have, ask first; don't invent.
2. **IBM Plex Sans for UI; IBM Plex Mono for all numerals, addresses, hashes, and gas.** Tabular figures on (`font-feature-settings: 'tnum' on`).
3. **Lucide icons via CDN**, 1.5px stroke. Never inline new SVG icons.
4. **Voice**: calm, direct, sentence case. No emoji. No exclamation marks. See README → CONTENT FUNDAMENTALS for the full guide.
5. **Hard avoids**: gradients (especially purple), glass/blur, neon, 3D coins, mascots, large rounded radii, decorative imagery, animations on content entry.
6. **Density matters**: this is a daily-use tool. Tight rhythm, small radii (4–8px), borders before shadows.

## Output modes

- **Throwaway mocks / prototypes / screenshots**: build self-contained HTML files. Copy assets out of `assets/` and tokens out of `colors_and_type.css`. Surface them in the user's preview.
- **Production code**: read components from `ui_kits/` and reimplement against the target codebase. The kits are deliberately written in plain JSX without project-specific deps so they're portable.

## When the user invokes this skill with no other context

Ask:
1. Which surface? (extension popup, web dashboard, mobile, marketing page, slide deck, doc, other)
2. Light mode, dark mode, or both?
3. Is this a real screen they want production-ready, or a quick mock to react to?
4. Anything off-brand they want to deliberately push against (e.g. "make it more playful for the onboarding only")?

Then act as an expert designer who understands SIMPLE's "calm utility" positioning. Output HTML artifacts by default; switch to production code when explicitly asked.
