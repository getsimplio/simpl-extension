import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BookUser,
  ChartNoAxesCombined,
  Clock3,
  Code2,
  Coins,
  CreditCard,
  Landmark,
  Layers,
  LifeBuoy,
  Network,
  PlugZap,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Usb,
  WalletCards,
} from "lucide-react";

export type SimpleInstrument =
  | "wallet"
  | "send"
  | "receive"
  | "swap"
  | "buy"
  | "bank"
  | "history"
  | "security"
  | "addressBook"
  | "networks"
  | "settings"
  | "portfolio"
  | "multiWallet"
  | "multiSend"
  | "ledger"
  | "dapps"
  | "ai"
  | "token"
  | "activity"
  | "support"
  | "developer";

const iconMap: Record<SimpleInstrument, LucideIcon> = {
  wallet: WalletCards,
  // Send / Receive / Swap share one directional-arrow family (out / in /
  // between) so the home quick actions read as a single, calm icon set rather
  // than three unrelated glyphs (paper-plane + QR + arrows).
  send: ArrowUpRight,
  receive: ArrowDownLeft,
  swap: ArrowLeftRight,
  buy: CreditCard,
  bank: Landmark,
  history: Clock3,
  security: ShieldCheck,
  addressBook: BookUser,
  networks: Network,
  settings: Settings,
  portfolio: ChartNoAxesCombined,
  multiWallet: Layers,
  multiSend: SendHorizontal,
  ledger: Usb,
  dapps: PlugZap,
  ai: Sparkles,
  token: Coins,
  activity: Activity,
  support: LifeBuoy,
  developer: Code2,
};

const colorClassMap: Record<SimpleInstrument, string> = {
  wallet: "simple-instrument-icon--wallet",
  send: "simple-instrument-icon--send",
  receive: "simple-instrument-icon--receive",
  swap: "simple-instrument-icon--swap",
  buy: "simple-instrument-icon--buy",
  bank: "simple-instrument-icon--bank",
  history: "simple-instrument-icon--history",
  security: "simple-instrument-icon--security",
  addressBook: "simple-instrument-icon--address",
  networks: "simple-instrument-icon--network",
  settings: "simple-instrument-icon--settings",
  portfolio: "simple-instrument-icon--portfolio",
  multiWallet: "simple-instrument-icon--multi",
  multiSend: "simple-instrument-icon--multi",
  ledger: "simple-instrument-icon--ledger",
  dapps: "simple-instrument-icon--dapps",
  ai: "simple-instrument-icon--ai",
  token: "simple-instrument-icon--token",
  activity: "simple-instrument-icon--activity",
  support: "simple-instrument-icon--support",
  developer: "simple-instrument-icon--developer",
};

const colorVarMap: Record<SimpleInstrument, { bg: string; fg: string }> = {
  wallet: { bg: "var(--simple-color-wallet-bg, #f1f1ee)", fg: "var(--simple-color-wallet-fg, #2c2c29)" },
  send: { bg: "var(--simple-color-send-bg, #eaf2ff)", fg: "var(--simple-color-send-fg, #2563eb)" },
  receive: { bg: "var(--simple-color-receive-bg, #eaf8ef)", fg: "var(--simple-color-receive-fg, #2f7d46)" },
  swap: { bg: "var(--simple-color-swap-bg, #f1eafe)", fg: "var(--simple-color-swap-fg, #7c3aed)" },
  buy: { bg: "var(--simple-color-buy-bg, #e8f8f1)", fg: "var(--simple-color-buy-fg, #059669)" },
  bank: { bg: "var(--simple-color-bank-bg, #eef2ff)", fg: "var(--simple-color-bank-fg, #4f46e5)" },
  history: { bg: "var(--simple-color-history-bg, #fff6df)", fg: "var(--simple-color-history-fg, #b7791f)" },
  security: { bg: "var(--simple-color-security-bg, #fff0f0)", fg: "var(--simple-color-security-fg, #dc2626)" },
  addressBook: { bg: "var(--simple-color-address-bg, #e6f7f5)", fg: "var(--simple-color-address-fg, #0f766e)" },
  networks: { bg: "var(--simple-color-network-bg, #e8f7fb)", fg: "var(--simple-color-network-fg, #0891b2)" },
  settings: { bg: "var(--simple-color-settings-bg, #f1f1f1)", fg: "var(--simple-color-settings-fg, #525252)" },
  portfolio: { bg: "var(--simple-color-portfolio-bg, #eef9df)", fg: "var(--simple-color-portfolio-fg, #4d7c0f)" },
  multiWallet: { bg: "var(--simple-color-multi-bg, #fff1e6)", fg: "var(--simple-color-multi-fg, #ea580c)" },
  multiSend: { bg: "var(--simple-color-multi-bg, #fff1e6)", fg: "var(--simple-color-multi-fg, #ea580c)" },
  ledger: { bg: "var(--simple-color-ledger-bg, #eef0f3)", fg: "var(--simple-color-ledger-fg, #334155)" },
  dapps: { bg: "var(--simple-color-dapps-bg, #f3e8ff)", fg: "var(--simple-color-dapps-fg, #9333ea)" },
  ai: { bg: "var(--simple-color-ai-bg, #fdf2f8)", fg: "var(--simple-color-ai-fg, #db2777)" },
  token: { bg: "var(--simple-color-token-bg, #fff7ed)", fg: "var(--simple-color-token-fg, #c2410c)" },
  activity: { bg: "var(--simple-color-activity-bg, #ecfeff)", fg: "var(--simple-color-activity-fg, #0e7490)" },
  support: { bg: "var(--simple-color-support-bg, #f0fdf4)", fg: "var(--simple-color-support-fg, #15803d)" },
  developer: { bg: "var(--simple-color-developer-bg, #f5f3ff)", fg: "var(--simple-color-developer-fg, #6d28d9)" },
};

type SimpleInstrumentIconProps = {
  instrument: SimpleInstrument;
  size?: number;
  iconSize?: number;
  className?: string;
};

export function SimpleInstrumentIcon({
  instrument,
  size,
  iconSize,
  className = "",
}: SimpleInstrumentIconProps) {
  const Icon = iconMap[instrument];
  const colors = colorVarMap[instrument];
  const resolvedIconSize = iconSize ?? size ?? 18;

  const style: CSSProperties = {
    width: 36,
    height: 36,
    minWidth: 36,
    borderRadius: 13,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background: colors.bg,
    color: colors.fg,
  };

  return (
    <span
      className={`simple-instrument-icon ${colorClassMap[instrument]} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <Icon size={resolvedIconSize} strokeWidth={1.9} />
    </span>
  );
}
