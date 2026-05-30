# SIMPL Wallet — Claude Handoff

Branch: main
Latest commit: cc217f7 — feat: add account avatars and asset details modal

## What was implemented

1. PixelAvatar in HomePage header
- Replaced `<span className="av" />` in the acct-chip button with `<PixelAvatar seed={selectedAccount.address} size={24} />`.

2. Asset Details Modal
- Stats row: Balance / Price / Value
- Native asset info card: asset type label + "View address ↗" explorer link
- ERC-20 info card: truncated contract address + Copy button with 1.5s "Copied" feedback + "View contract ↗" explorer link
- Primary actions: Send / Swap buttons
- Activity section: last 5 transactions filtered by chainId + asset, with type / amount / status badge / explorer link
- "View all activity ›" opens history page
- Hide / Remove secondary actions preserved for ERC-20
- Modal scroll: overflow-y: auto, max-height: min(calc(100vh - 48px), 560px)

## Files changed

- src/popup/routes/HomePage.tsx
- src/ui/claude/styles/runtime-overrides.css
- src/popup/components/PixelAvatar.tsx
- src/popup/routes/AccountPage.tsx
- src/popup/routes/AccountPage.css

## Security constraints

- Do NOT change WalletConnect offscreen engine
- Do NOT change vault/seed/private key logic
- Do NOT change swap logic unless explicitly requested
- Every signature request must open an approval popup
- Every dApp-requested network switch must show approval
- Never return private key or seed
- Never log password
- Do not store password
- Do NOT implement wallet_addEthereumChain

## Known issues / not yet tested

- Modal has not been visually verified in browser
- Build passes clean, no TypeScript errors
- Swap button does not prefill the from-token yet because SwapPage has no initialFromToken prop

## Build

rm -rf dist && npm run build

## Manual test

Load unpacked extension from dist/ in chrome://extensions.

Test:
- Click native asset
- Click ERC-20 asset
- Verify Balance / Price / Value
- Verify Copy feedback
- Verify explorer links
- Verify Send / Swap buttons
- Verify modal scroll
- Verify PixelAvatar in top-bar account chip
