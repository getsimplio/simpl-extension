import { useEffect, useState } from "react";
import { t, useTranslation } from "../../i18n";

// chrome is a global in extension pages
declare const chrome: typeof globalThis extends { chrome: infer C } ? C : never;

// ─── Types ────────────────────────────────────────────────────────────────────

type TypedDataDisplay = {
  domainName?: string;
  verifyingContract?: string;
  primaryType?: string;
  messageJson?: string;
};

type SwitchChainData = {
  requestedChainId: number;
  requestedChainName: string;
  currentChainId: number;
  currentChainName: string;
};

type Erc20ApproveData = {
  spender: string;
  amountRaw: string;
  isUnlimited: boolean;
};

type TransactionDisplayData = {
  from: string;
  to: string;
  value: string;
  data?: string;
  networkName: string;
  nativeCurrencySymbol: string;
  erc20Approve?: Erc20ApproveData;
};

type TronTxDisplay = {
  contractType?: string;
  json?: string;
};

type PendingData = {
  origin: string;
  address: string | null;
  chainId: number;
  kind:
    | "connect"
    | "personal_sign"
    | "typed_data"
    | "switch_chain"
    | "transaction"
    | "tron_connect"
    | "tron_sign";
  // Human network label provided for TRON (e.g. "TRON Mainnet").
  network?: string;
  chainIdHex?: string;
  displayMessage?: string;
  typedDataDisplay?: TypedDataDisplay;
  switchChain?: SwitchChainData;
  transaction?: TransactionDisplayData;
  tronTransaction?: TronTxDisplay;
};

type PageState =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "ready"; data: PendingData }
  | { status: "error"; message: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function chainLabel(chainId: number): string {
  const names: Record<number, string> = {
    1: "Ethereum",
    56: "BNB Smart Chain",
    8453: "Base",
    11155111: "Sepolia",
  };
  return names[chainId] ?? `Chain ${chainId}`;
}

function safeHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function formatHexEth(hexValue: string, symbol: string): string {
  try {
    const wei = BigInt(hexValue);
    if (wei === 0n) return `0 ${symbol}`;
    const eth = Number(wei) / 1e18;
    const formatted = eth < 0.000001 ? "< 0.000001" : eth.toFixed(6).replace(/\.?0+$/, "");
    return `${formatted} ${symbol}`;
  } catch {
    return `${hexValue} (raw)`;
  }
}

// ─── Design tokens (match WalletConnectPage exactly) ─────────────────────────

const C = {
  bg: "var(--bg-muted)",
  fg: "var(--ink-1)",
  fgMuted: "var(--ink-3)",
  fgDim: "var(--ink-3)",
  border: "var(--line)",
  cardBg: "var(--bg-surface)",
  cardBorder: "var(--line)",
  previewBg: "var(--bg-muted)",
  previewBorder: "var(--line)",
  previewText: "var(--ink-3)",
  warnBg: "var(--warn-soft)",
  warnBorder: "var(--warn-soft)",
  warnText: "var(--warn)",
  noticeBg: "var(--bg-muted)",
  noticeText: "var(--ink-3)",
  danger: "var(--danger)",
  monoFont: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
};

// ─── Shared layout shells ─────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      position: "fixed", inset: 0,
      height: "100dvh", minHeight: "100dvh", width: "100vw",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      background: C.bg, color: C.fg,
      boxSizing: "border-box",
    }}>
      {children}
    </main>
  );
}

function ApprovalHeader({ title, onClose, disabled }: { title: string; onClose: () => void; disabled?: boolean }) {
  return (
    <header style={{
      height: 56, flexShrink: 0,
      display: "flex", alignItems: "center", gap: 12,
      padding: "0 14px",
      borderBottom: `1px solid ${C.border}`,
      background: C.bg,
      boxSizing: "border-box",
    }}>
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        disabled={disabled}
        style={{
          width: 34, height: 34,
          border: "none", borderRadius: 12,
          background: "transparent",
          color: C.fg,
          cursor: "pointer",
          fontSize: 22, lineHeight: "30px",
          padding: 0, flexShrink: 0,
        }}
      >
        ×
      </button>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>
        {title}
      </div>
    </header>
  );
}

function ScrollSection({ children }: { children: React.ReactNode }) {
  return (
    <section style={{
      flex: 1, minHeight: 0,
      overflowY: "auto",
      padding: "14px 14px 140px",
      width: "100%",
      display: "grid", gap: 14,
      alignContent: "start",
      boxSizing: "border-box",
    }}>
      {children}
    </section>
  );
}

function ApprovalFooter({
  primaryLabel,
  onPrimary,
  onReject,
  working,
  primaryDisabled,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onReject: () => void;
  working: boolean;
  primaryDisabled?: boolean;
}) {
  const blocked = working || primaryDisabled;
  return (
    <footer style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
      borderTop: `1px solid ${C.border}`,
      background: C.bg,
      padding: "10px 14px 14px",
      display: "grid", gap: 10,
      boxSizing: "border-box",
      boxShadow: `0 -16px 28px rgba(247,247,244,0.96)`,
    }}>
      <button
        type="button"
        onClick={onPrimary}
        disabled={blocked}
        style={{
          width: "100%", height: 46,
          borderRadius: 13, border: "none",
          background: blocked ? "var(--line-strong)" : C.fg,
          color: "var(--bg-surface)",
          fontSize: 16, fontWeight: 850,
          cursor: blocked ? "default" : "pointer",
        }}
      >
        {working ? t("common.processing") : primaryLabel}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={working}
        style={{
          width: "100%", height: 46,
          borderRadius: 13,
          border: "1px solid var(--line-strong)",
          background: C.cardBg,
          color: C.fg,
          fontSize: 16, fontWeight: 750,
          cursor: working ? "default" : "pointer",
        }}
      >
        {t("approval.reject")}
      </button>
    </footer>
  );
}

// ─── Reusable sub-components ──────────────────────────────────────────────────

function SimplIcon() {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: 15,
      background: C.fg, color: "var(--bg-surface)",
      display: "grid", placeItems: "center",
      fontSize: 15, fontWeight: 800,
      flexShrink: 0,
    }}>
      S
    </div>
  );
}

function ApprovalCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${C.cardBorder}`,
      borderRadius: 16,
      background: C.cardBg,
      padding: 12,
      display: "grid", gap: 14,
      boxSizing: "border-box",
    }}>
      {children}
    </div>
  );
}

function AccountRow({ address }: { address: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px",
      border: `1px solid ${C.previewBorder}`,
      borderRadius: 13,
      background: C.previewBg,
      boxSizing: "border-box",
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 10,
        background: C.fg, opacity: 0.12, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.fgMuted, marginBottom: 1 }}>{t("approval.wallet")}</div>
        <div style={{
          fontSize: 13, fontWeight: 700,
          fontFamily: C.monoFont,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {shortAddress(address)}
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 800,
        color: "var(--secure)",
        background: "var(--secure-soft)",
        padding: "2px 8px", borderRadius: 8,
        flexShrink: 0,
      }}>
        {t("approval.active")}
      </div>
    </div>
  );
}

function PreviewBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${C.previewBorder}`,
      borderRadius: 15,
      background: C.previewBg,
      padding: 14,
      display: "grid", gap: 10,
      overflow: "hidden",
      boxSizing: "border-box",
    }}>
      <div style={{ fontSize: 13, fontWeight: 850, letterSpacing: "-0.01em" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MonoPre({ text }: { text: string }) {
  return (
    <pre style={{
      margin: 0,
      maxHeight: 128, overflowY: "auto",
      whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere",
      fontFamily: C.monoFont,
      color: C.previewText,
      fontSize: 12, lineHeight: "18px",
    }}>
      {text.trim() || t("approval.empty")}
    </pre>
  );
}

function SigningWarning() {
  return (
    <div style={{
      borderRadius: 14,
      background: C.warnBg,
      border: `1px solid ${C.warnBorder}`,
      color: C.warnText,
      padding: "10px 12px",
      fontSize: 12, lineHeight: "17px", fontWeight: 750,
    }}>
      {t("approval.signingWarning")}
    </div>
  );
}

function TransactionWarning() {
  return (
    <div style={{
      borderRadius: 14,
      background: C.warnBg,
      border: `1px solid ${C.warnBorder}`,
      color: C.warnText,
      padding: "10px 12px",
      fontSize: 12, lineHeight: "17px", fontWeight: 750,
    }}>
      {t("approval.transactionWarning")}
    </div>
  );
}

function UnlimitedApprovalWarning() {
  return (
    <div style={{
      borderRadius: 14,
      background: C.warnBg,
      border: `1px solid ${C.warnBorder}`,
      color: C.warnText,
      padding: "10px 12px",
      fontSize: 12, lineHeight: "17px", fontWeight: 750,
    }}>
      {t("approval.unlimitedWarning")}
    </div>
  );
}

function OriginNotice({ domain, method }: { domain: string; method: string }) {
  return (
    <div style={{
      borderRadius: 14,
      background: C.noticeBg,
      color: C.noticeText,
      padding: "10px 12px",
      fontSize: 12, lineHeight: "17px",
    }}>
      {t("approval.requestedBy", { method, domain })}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  onEnter,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{
        fontSize: 11, fontWeight: 850, letterSpacing: "0.12em",
        textTransform: "uppercase", color: C.fgMuted,
      }}>
        {t("common.walletPassword")}
      </label>
      <input
        type="password"
        autoComplete="current-password"
        placeholder={t("approval.enterPasswordToSign")}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim() && onEnter) onEnter();
        }}
        style={{
          width: "100%", height: 44,
          borderRadius: 12,
          border: `1px solid ${C.cardBorder}`,
          background: C.cardBg,
          padding: "0 14px",
          fontSize: 15,
          color: C.fg,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div style={{ color: C.danger, fontSize: 13, lineHeight: "18px", fontWeight: 700 }}>
      {message}
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function DappApprovalPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [working, setWorking] = useState(false);
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const approvalId = new URLSearchParams(location.search).get("id") ?? "";

  useEffect(() => {
    if (!approvalId) {
      setState({ status: "error", message: t("approval.missingId") });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome as any).runtime.sendMessage(
      { type: "SIMPL_DAPP_GET_PENDING", id: approvalId },
      (response: { ok: boolean; pending?: PendingData; error?: string } | null) => {
        if (!response?.ok) {
          setState({ status: "error", message: response?.error ?? t("approval.requestNotFound") });
          return;
        }
        const pending = response.pending!;
        if (!pending.address) {
          setState({ status: "locked" });
          return;
        }
        setState({ status: "ready", data: pending });
      },
    );
  }, [approvalId]);

  function reject() {
    setWorking(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome as any).runtime.sendMessage(
      { type: "SIMPL_DAPP_REJECT", id: approvalId },
      () => { window.close(); },
    );
  }

  function approve() {
    if (state.status !== "ready") return;
    setWorking(true);
    setErrorMsg("");
    const needsPassword = state.data.kind === "personal_sign" || state.data.kind === "typed_data" || state.data.kind === "transaction" || state.data.kind === "tron_sign";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome as any).runtime.sendMessage(
      {
        type: "SIMPL_DAPP_APPROVE",
        id: approvalId,
        ...(needsPassword ? { password } : {}),
      },
      (response: { ok: boolean; error?: string } | null) => {
        if (response?.ok) {
          window.close();
        } else {
          setWorking(false);
          setErrorMsg(response?.error ?? t("approval.actionFailed"));
        }
      },
    );
  }

  // ── Loading ──

  if (state.status === "loading") {
    return (
      <Shell>
        <div style={{
          flex: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ color: C.fgMuted, fontSize: 14 }}>{t("common.loading")}</span>
        </div>
      </Shell>
    );
  }

  // ── Error ──

  if (state.status === "error") {
    return (
      <Shell>
        <div style={{
          flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 12, padding: 24,
        }}>
          <span style={{ fontSize: 32 }}>⚠</span>
          <p style={{ color: C.fgMuted, fontSize: 14, textAlign: "center", margin: 0 }}>
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => window.close()}
            style={{
              marginTop: 8, height: 40, padding: "0 20px",
              borderRadius: 12, border: `1px solid ${C.cardBorder}`,
              background: C.cardBg, color: C.fg,
              fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Locked ──

  if (state.status === "locked") {
    return (
      <Shell>
        <div style={{
          flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, padding: 24,
        }}>
          <span style={{ fontSize: 40 }}>🔒</span>
          <p style={{ fontWeight: 800, fontSize: 17, margin: 0, letterSpacing: "-0.02em" }}>
            {t("approval.walletLockedTitle")}
          </p>
          <p style={{ color: C.fgMuted, fontSize: 13, textAlign: "center", margin: 0, lineHeight: "19px" }}>
            {t("approval.walletLockedBody")}
          </p>
          <button
            type="button"
            onClick={() => window.close()}
            style={{
              marginTop: 4, height: 46, padding: "0 24px",
              borderRadius: 13, border: `1px solid ${C.cardBorder}`,
              background: C.cardBg, color: C.fg,
              fontSize: 15, fontWeight: 750, cursor: "pointer",
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Ready ──

  const { data } = state;
  const domain = safeHostname(data.origin);
  const kind = data.kind ?? "connect";

  // ── personal_sign ──

  if (kind === "personal_sign") {
    return (
      <Shell>
        <ApprovalHeader title={t("approval.signMessage")} onClose={reject} disabled={working} />
        <ScrollSection>
          <div style={{ display: "grid", gap: 14 }}>
            <SimplIcon />
            <div style={{ display: "grid", gap: 7 }}>
              <h1 style={{
                margin: 0, fontSize: 24, lineHeight: "27px",
                letterSpacing: "-0.055em", fontWeight: 880,
              }}>
                {t("approval.signMessage")}
              </h1>
              <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
                {t("approval.signMessageDesc", { domain })}
              </p>
            </div>
          </div>

          <ApprovalCard>
            <AccountRow address={data.address!} />
            <PreviewBox title={t("approval.messagePreview")}>
              <MonoPre text={data.displayMessage ?? ""} />
            </PreviewBox>
          </ApprovalCard>

          <SigningWarning />

          <ApprovalCard>
            <PasswordInput
              value={password}
              onChange={setPassword}
              onEnter={password.trim() ? approve : undefined}
              disabled={working}
            />
            {errorMsg && <ErrorLine message={errorMsg} />}
          </ApprovalCard>

          <OriginNotice domain={domain} method="personal_sign" />
        </ScrollSection>
        <ApprovalFooter
          primaryLabel={t("approval.sign")}
          onPrimary={approve}
          onReject={reject}
          working={working}
          primaryDisabled={!password.trim()}
        />
      </Shell>
    );
  }

  // ── typed_data ──

  if (kind === "typed_data") {
    const td = data.typedDataDisplay ?? {};
    return (
      <Shell>
        <ApprovalHeader title={t("approval.signTypedData")} onClose={reject} disabled={working} />
        <ScrollSection>
          <div style={{ display: "grid", gap: 14 }}>
            <SimplIcon />
            <div style={{ display: "grid", gap: 7 }}>
              <h1 style={{
                margin: 0, fontSize: 24, lineHeight: "27px",
                letterSpacing: "-0.055em", fontWeight: 880,
              }}>
                {t("approval.signTypedData")}
              </h1>
              <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
                {t("approval.signTypedDataDesc", { domain })}
              </p>
            </div>
          </div>

          <ApprovalCard>
            <AccountRow address={data.address!} />

            {(td.domainName || td.primaryType || td.verifyingContract) && (
              <PreviewBox title={t("approval.details")}>
                <div style={{ display: "grid", gap: 8 }}>
                  {td.domainName && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: C.fgMuted }}>{t("approval.app")}</span>
                      <span style={{ fontWeight: 700 }}>{td.domainName}</span>
                    </div>
                  )}
                  {td.primaryType && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: C.fgMuted }}>{t("common.type")}</span>
                      <span style={{ fontWeight: 700 }}>{td.primaryType}</span>
                    </div>
                  )}
                  {td.verifyingContract && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: C.fgMuted }}>{t("common.contract")}</span>
                      <span style={{ fontFamily: C.monoFont, fontSize: 12 }}>
                        {shortAddress(td.verifyingContract)}
                      </span>
                    </div>
                  )}
                </div>
              </PreviewBox>
            )}

            {td.messageJson && (
              <PreviewBox title={t("approval.dataPreview")}>
                <MonoPre text={td.messageJson} />
              </PreviewBox>
            )}
          </ApprovalCard>

          <SigningWarning />

          <ApprovalCard>
            <PasswordInput
              value={password}
              onChange={setPassword}
              onEnter={password.trim() ? approve : undefined}
              disabled={working}
            />
            {errorMsg && <ErrorLine message={errorMsg} />}
          </ApprovalCard>

          <OriginNotice domain={domain} method="eth_signTypedData_v4" />
        </ScrollSection>
        <ApprovalFooter
          primaryLabel={t("approval.sign")}
          onPrimary={approve}
          onReject={reject}
          working={working}
          primaryDisabled={!password.trim()}
        />
      </Shell>
    );
  }

  // ── transaction ──

  if (kind === "transaction") {
    const tx = data.transaction;
    const erc20 = tx?.erc20Approve ?? null;
    const symbol = tx?.nativeCurrencySymbol ?? "ETH";
    const hasData = !erc20 && tx?.data && tx.data !== "0x" && tx.data.length > 2;

    const title = erc20 ? t("approval.approveTokenSpending") : t("approval.confirmTransaction");

    return (
      <Shell>
        <ApprovalHeader title={title} onClose={reject} disabled={working} />
        <ScrollSection>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 15,
              background: C.cardBg, border: `1px solid ${C.cardBorder}`,
              display: "grid", placeItems: "center", fontSize: 22,
            }}>
              {erc20 ? "🔑" : "⬆"}
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              <h1 style={{
                margin: 0, fontSize: 24, lineHeight: "27px",
                letterSpacing: "-0.055em", fontWeight: 880,
              }}>
                {title}
              </h1>
              <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
                {erc20
                  ? t("approval.spendPermissionDesc", { domain })
                  : t("approval.transactionDesc", { domain })
                }
              </p>
            </div>
          </div>

          <ApprovalCard>
            <AccountRow address={data.address!} />

            {erc20 ? (
              <PreviewBox title={t("approval.tokenApproval")}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gap: 3 }}>
                    <span style={{ fontSize: 11, color: C.fgMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("approval.tokenContract")}</span>
                    <span style={{ fontSize: 12, fontFamily: C.monoFont, wordBreak: "break-all" }}>{tx?.to}</span>
                  </div>
                  <div style={{ display: "grid", gap: 3 }}>
                    <span style={{ fontSize: 11, color: C.fgMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("approval.spender")}</span>
                    <span style={{ fontSize: 12, fontFamily: C.monoFont, wordBreak: "break-all" }}>{erc20.spender}</span>
                  </div>
                  <div style={{ display: "grid", gap: 3 }}>
                    <span style={{ fontSize: 11, color: C.fgMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("common.amount")}</span>
                    {erc20.isUnlimited ? (
                      <span style={{ fontSize: 14, fontWeight: 800, color: C.danger }}>{t("approval.unlimited")}</span>
                    ) : (
                      <span style={{ fontSize: 12, fontFamily: C.monoFont, wordBreak: "break-all" }}>
                        {erc20.amountRaw}
                      </span>
                    )}
                  </div>
                </div>
              </PreviewBox>
            ) : (
              <PreviewBox title={t("approval.transactionDetails")}>
                <div style={{ display: "grid", gap: 8 }}>
                  {tx && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
                        <span style={{ color: C.fgMuted, flexShrink: 0 }}>{t("common.to")}</span>
                        <span style={{ fontWeight: 700, fontFamily: C.monoFont, fontSize: 12, textAlign: "right", wordBreak: "break-all" }}>
                          {tx.to}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: C.fgMuted }}>{t("common.network")}</span>
                        <span style={{ fontWeight: 700 }}>{tx.networkName}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: C.fgMuted }}>{t("common.value")}</span>
                        <span style={{ fontWeight: 700 }}>{formatHexEth(tx.value, symbol)}</span>
                      </div>
                    </>
                  )}
                </div>
              </PreviewBox>
            )}

            {hasData && tx?.data && (
              <PreviewBox title={t("approval.contractData")}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: C.fgMuted }}>
                    {t("approval.function")} <span style={{ fontFamily: C.monoFont, color: C.fg }}>{tx.data.slice(0, 10)}</span>
                  </div>
                  <MonoPre text={tx.data.length > 200 ? `${tx.data.slice(0, 200)}…` : tx.data} />
                </div>
              </PreviewBox>
            )}
          </ApprovalCard>

          {erc20?.isUnlimited ? <UnlimitedApprovalWarning /> : <TransactionWarning />}

          <ApprovalCard>
            <PasswordInput
              value={password}
              onChange={setPassword}
              onEnter={password.trim() ? approve : undefined}
              disabled={working}
            />
            {errorMsg && <ErrorLine message={errorMsg} />}
          </ApprovalCard>

          <OriginNotice domain={domain} method="eth_sendTransaction" />
        </ScrollSection>
        <ApprovalFooter
          primaryLabel={erc20 ? t("approval.approve") : t("approval.confirm")}
          onPrimary={approve}
          onReject={reject}
          working={working}
          primaryDisabled={!password.trim()}
        />
      </Shell>
    );
  }

  // ── switch_chain ──

  if (kind === "switch_chain") {
    const sc = data.switchChain;
    return (
      <Shell>
        <ApprovalHeader title={t("approval.switchNetwork")} onClose={reject} disabled={working} />
        <ScrollSection>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 15,
              background: C.cardBg, border: `1px solid ${C.cardBorder}`,
              display: "grid", placeItems: "center", fontSize: 22,
            }}>
              🔗
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              <h1 style={{
                margin: 0, fontSize: 24, lineHeight: "27px",
                letterSpacing: "-0.055em", fontWeight: 880,
              }}>
                {t("approval.switchNetwork")}
              </h1>
              <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
                {t("approval.switchNetworkDesc", { domain })}
              </p>
            </div>
          </div>

          <ApprovalCard>
            {sc ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  border: `1px solid ${C.previewBorder}`,
                  borderRadius: 13,
                  background: C.previewBg,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.fgMuted, marginBottom: 1 }}>{t("approval.currentNetwork")}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{sc.currentChainName}</div>
                  </div>
                </div>

                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, color: C.fgMuted,
                }}>
                  ↓
                </div>

                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  border: `1px solid ${C.previewBorder}`,
                  borderRadius: 13,
                  background: C.previewBg,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.fgMuted, marginBottom: 1 }}>{t("approval.requestedNetwork")}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{sc.requestedChainName}</div>
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 800,
                    color: "var(--secure)", background: "var(--secure-soft)",
                    padding: "2px 8px", borderRadius: 8, flexShrink: 0,
                  }}>
                    {t("approval.new")}
                  </div>
                </div>
              </div>
            ) : null}

            <div style={{
              borderRadius: 12,
              background: C.warnBg,
              border: `1px solid ${C.warnBorder}`,
              color: C.warnText,
              padding: "10px 12px",
              fontSize: 12, lineHeight: "17px", fontWeight: 750,
            }}>
              {t("approval.switchNetworkWarning")}
            </div>
          </ApprovalCard>

          <OriginNotice domain={domain} method="wallet_switchEthereumChain" />

          {errorMsg && <ErrorLine message={errorMsg} />}
        </ScrollSection>
        <ApprovalFooter
          primaryLabel={t("approval.switch")}
          onPrimary={approve}
          onReject={reject}
          working={working}
        />
      </Shell>
    );
  }

  // ── tron_connect ──

  if (kind === "tron_connect") {
    return (
      <Shell>
        <ApprovalHeader title={t("approval.connectWallet")} onClose={reject} disabled={working} />
        <ScrollSection>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 15,
              background: C.cardBg, border: `1px solid ${C.cardBorder}`,
              display: "grid", placeItems: "center", fontSize: 24,
            }}>
              ⚡
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              <h1 style={{
                margin: 0, fontSize: 24, lineHeight: "27px",
                letterSpacing: "-0.055em", fontWeight: 880,
              }}>
                {domain}
              </h1>
              <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
                {t("approval.tronConnectDesc")}
              </p>
            </div>
          </div>

          <ApprovalCard>
            <AccountRow address={data.address!} />

            <div style={{
              border: `1px solid ${C.previewBorder}`,
              borderRadius: 13, background: C.previewBg, padding: 14,
              display: "grid", gap: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 850, letterSpacing: "-0.01em" }}>
                {t("common.network")}
              </div>
              <div style={{ fontSize: 13, color: C.fgMuted }}>
                {data.network ?? "TRON Mainnet"}
              </div>
            </div>

            <div style={{
              border: `1px solid ${C.previewBorder}`,
              borderRadius: 13, background: C.previewBg, padding: 14,
              display: "grid", gap: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 850, letterSpacing: "-0.01em" }}>
                {t("approval.permissions")}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {(["approval.viewTronAddress", "approval.viewBalance"] as const).map((p) => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ color: "var(--secure)", fontSize: 14, fontWeight: 700 }}>✓</span>
                    <span style={{ color: C.fgMuted }}>{t(p)}</span>
                  </div>
                ))}
              </div>
            </div>
          </ApprovalCard>

          <OriginNotice domain={domain} method="tron_requestAccounts" />

          {errorMsg && <ErrorLine message={errorMsg} />}
        </ScrollSection>
        <ApprovalFooter
          primaryLabel={t("approval.connect")}
          onPrimary={approve}
          onReject={reject}
          working={working}
        />
      </Shell>
    );
  }

  // ── tron_sign ──

  if (kind === "tron_sign") {
    const ttx = data.tronTransaction ?? {};
    return (
      <Shell>
        <ApprovalHeader title={t("approval.signTronTx")} onClose={reject} disabled={working} />
        <ScrollSection>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 15,
              background: C.cardBg, border: `1px solid ${C.cardBorder}`,
              display: "grid", placeItems: "center", fontSize: 22,
            }}>
              ⚡
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              <h1 style={{
                margin: 0, fontSize: 24, lineHeight: "27px",
                letterSpacing: "-0.055em", fontWeight: 880,
              }}>
                {t("approval.signTronTx")}
              </h1>
              <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
                {t("approval.tronTxDesc", { domain })}
              </p>
            </div>
          </div>

          <ApprovalCard>
            <AccountRow address={data.address!} />

            <PreviewBox title={t("approval.transaction")}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: C.fgMuted }}>{t("common.network")}</span>
                  <span style={{ fontWeight: 700 }}>{data.network ?? "TRON Mainnet"}</span>
                </div>
                {ttx.contractType && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: C.fgMuted }}>{t("common.type")}</span>
                    <span style={{ fontWeight: 700 }}>{ttx.contractType}</span>
                  </div>
                )}
              </div>
            </PreviewBox>

            {ttx.json && (
              <PreviewBox title={t("approval.rawTransaction")}>
                <MonoPre text={ttx.json} />
              </PreviewBox>
            )}
          </ApprovalCard>

          <SigningWarning />

          <ApprovalCard>
            <PasswordInput
              value={password}
              onChange={setPassword}
              onEnter={password.trim() ? approve : undefined}
              disabled={working}
            />
            {errorMsg && <ErrorLine message={errorMsg} />}
          </ApprovalCard>

          <OriginNotice domain={domain} method="tron_signTransaction" />
        </ScrollSection>
        <ApprovalFooter
          primaryLabel={t("approval.sign")}
          onPrimary={approve}
          onReject={reject}
          working={working}
          primaryDisabled={!password.trim()}
        />
      </Shell>
    );
  }

  // ── connect (default) ──

  return (
    <Shell>
      <ApprovalHeader title={t("approval.connectWallet")} onClose={reject} disabled={working} />
      <ScrollSection>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 15,
            background: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            display: "grid", placeItems: "center",
            fontSize: 26,
          }}>
            🌐
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            <h1 style={{
              margin: 0, fontSize: 24, lineHeight: "27px",
              letterSpacing: "-0.055em", fontWeight: 880,
            }}>
              {domain}
            </h1>
            <p style={{ margin: 0, color: C.fgMuted, fontSize: 13, lineHeight: "19px" }}>
              {t("approval.connectDesc")}
            </p>
          </div>
        </div>

        <ApprovalCard>
          <AccountRow address={data.address!} />

          <div style={{
            border: `1px solid ${C.previewBorder}`,
            borderRadius: 13,
            background: C.previewBg,
            padding: 14,
            display: "grid", gap: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 850, letterSpacing: "-0.01em" }}>
              {t("common.network")}
            </div>
            <div style={{ fontSize: 13, color: C.fgMuted }}>
              {chainLabel(data.chainId)}
            </div>
          </div>

          <div style={{
            border: `1px solid ${C.previewBorder}`,
            borderRadius: 13,
            background: C.previewBg,
            padding: 14,
            display: "grid", gap: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 850, letterSpacing: "-0.01em" }}>
              {t("approval.permissions")}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {(["approval.viewAddress", "approval.viewBalance"] as const).map((p) => (
                <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ color: "var(--secure)", fontSize: 14, fontWeight: 700 }}>✓</span>
                  <span style={{ color: C.fgMuted }}>{t(p)}</span>
                </div>
              ))}
            </div>
          </div>
        </ApprovalCard>

        <OriginNotice domain={domain} method="eth_requestAccounts" />

        {errorMsg && <ErrorLine message={errorMsg} />}
      </ScrollSection>
      <ApprovalFooter
        primaryLabel={t("approval.connect")}
        onPrimary={approve}
        onReject={reject}
        working={working}
      />
    </Shell>
  );
}
