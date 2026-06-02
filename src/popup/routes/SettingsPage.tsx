// src/popup/routes/SettingsPage.tsx

import { useState } from "react";
import type { WalletState } from "../../core/storage/storage.types";
import {
  SimpleInstrumentIcon,
  type SimpleInstrument,
} from "../components/SimpleInstrumentIcon";
import { walletService } from "../../core/wallet/wallet.service";
import { storageRepository } from "../../core/storage/storage.repository";
import { nativeMessagingClient } from "../../core/native/native-messaging.client";
import {
  encodeSecretToBase64,
  getBiometricWalletId,
} from "../../core/security/biometric-unlock.helpers";
import { openFullscreenApp, openSidePanel } from "../surface-actions";
import { getNetworkDisplayName } from "../../core/networks/chain-registry";
import { SelectNetworkPage } from "../components/SelectNetworkPage";

import SecurityCenterPage from "./SecurityCenterPage";


type SettingsConfirmAction = "clear-wallet" | null;

type SettingsPageProps = {
  walletState: WalletState;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onRevealSeed: () => void;
  onRevealPrivateKey: () => void;
};

type ChainOption = {
  chainId: number;
  name: string;
  nativeSymbol: string;
  subtitle: string;
};

const CHAIN_OPTIONS: ChainOption[] = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 1",
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    nativeSymbol: "BNB",
    subtitle: "BNB · Chain 56",
  },
  {
    chainId: 8453,
    name: "Base",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 8453",
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 11155111",
  },
];

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"
        fill="none"
        stroke="currentColor"
      />
      <path
        d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A8.6 8.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8.6 8.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5z"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" fill="none" stroke="currentColor" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" />
      <path d="M14 5v14" fill="none" stroke="currentColor" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-2.8 8.5-7 10-4.2-1.5-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" />
      <path d="M11 12l8-8M16 4l4 4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" fill="none" stroke="currentColor" />
    </svg>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      className="lbl"
      style={{
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Chevron() {
  return <div className="q">›</div>;
}

function Row({
  icon,
  instrument,
  title,
  subtitle,
  value,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  instrument?: SimpleInstrument;
  title: string;
  subtitle?: string;
  value?: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="row"
      onClick={onClick}
      style={{
        width: "100%",
        border: 0,
        background: "transparent",
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {instrument ? (
        <SimpleInstrumentIcon instrument={instrument} />
      ) : (
        <div
          className="tok"
          style={
            danger
              ? {
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                }
              : undefined
          }
        >
          {icon}
        </div>
      )}

      <div className="body">
        <div
          className="nm"
          style={danger ? { color: "var(--danger)" } : undefined}
        >
          {title}
        </div>

        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>

      <div className="num">
        {value ? <div className="v">{value}</div> : onClick ? <Chevron /> : null}
      </div>
    </button>
  );
}

function getActiveChain(chainId: number): ChainOption {
  return (
    CHAIN_OPTIONS.find((chain) => chain.chainId === chainId) ?? {
      chainId,
      name: `Chain ${chainId}`,
      nativeSymbol: "EVM",
      subtitle: `Chain ${chainId}`,
    }
  );
}

export function SettingsPage({
  walletState,
  onBack,
  onChanged,
  onRevealSeed,
  onRevealPrivateKey,
}: SettingsPageProps) {  const [showSecurityCenter, setShowSecurityCenter] = useState(false);
  const [settingsConfirmAction, setSettingsConfirmAction] = useState<SettingsConfirmAction>(null);

  const [nativeStatus, setNativeStatus] = useState<string | null>(null);
  const [touchIdPassword, setTouchIdPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [networkSelectorOpen, setNetworkSelectorOpen] = useState(false);

  const biometricEnabled = walletState.settings.biometricUnlock.enabled;
  const walletId = getBiometricWalletId(walletState);
  const activeChain = getActiveChain(walletState.selectedChainId);

  async function handleChanged() {
    await onChanged();
  }

  async function selectChain(chainId: number) {
    setNetworkSelectorOpen(false);
    await walletService.setSelectedChainId(chainId);
    await handleChanged();
  }

  async function enableTouchIdUnlock() {
    setNativeStatus(null);

    if (!touchIdPassword) {
      setNativeStatus("Enter wallet password first.");
      return;
    }

    setSaving(true);
    setNativeStatus("Checking wallet password...");

    try {
      await walletService.unlockWallet({
        password: touchIdPassword,
      });
    } catch {
      setNativeStatus("Wrong wallet password.");
      setSaving(false);
      return;
    }

    setNativeStatus("Saving unlock secret to macOS Keychain...");

    const passwordBase64 = encodeSecretToBase64(touchIdPassword);

    const response = await nativeMessagingClient.storeVaultKey(
      walletId,
      passwordBase64,
    );

    if (!response.ok) {
      setNativeStatus(`Touch ID setup error: ${response.error}`);
      setSaving(false);
      return;
    }

    const verifyResponse = await nativeMessagingClient.getVaultKey(walletId);

    if (!verifyResponse.ok) {
      setNativeStatus(`Touch ID verification error: ${verifyResponse.error}`);
      setSaving(false);
      return;
    }

    await storageRepository.updateSettings({
      biometricUnlock: {
        enabled: true,
        credentialId: walletId,
        createdAt: new Date().toISOString(),
      },
    });

    setTouchIdPassword("");
    setNativeStatus("Touch ID unlock enabled.");
    setSaving(false);

    await handleChanged();
  }

  async function disableTouchIdUnlock() {
    setSaving(true);
    setNativeStatus("Disabling Touch ID unlock...");

    const credentialId =
      walletState.settings.biometricUnlock.credentialId ?? walletId;

    const response = await nativeMessagingClient.deleteVaultKey(credentialId);

    if (!response.ok) {
      setNativeStatus(`Touch ID disable error: ${response.error}`);
      setSaving(false);
      return;
    }

    await storageRepository.updateSettings({
      biometricUnlock: {
        enabled: false,
        credentialId: null,
        createdAt: null,
      },
    });

    setNativeStatus("Touch ID unlock disabled.");
    setSaving(false);

    await handleChanged();
  }

  async function lockWallet() {
    walletService.lockWallet();
    await handleChanged();
  }

    async function clearWallet() {
    setSettingsConfirmAction("clear-wallet");
  }

  async function executeClearWallet() {
    setSettingsConfirmAction(null);

    const credentialId =
      walletState.settings.biometricUnlock.credentialId ?? walletId;

    await nativeMessagingClient.deleteVaultKey(credentialId);
    await walletService.clearWallet();

    await handleChanged();
  }

  // Network selection — the shared full-screen selector (no modal/sheet).
  if (networkSelectorOpen) {
    return (
      <SelectNetworkPage
        purpose="active"
        selectedChainId={walletState.selectedChainId}
        onSelect={(chainId) => void selectChain(chainId)}
        onBack={() => setNetworkSelectorOpen(false)}
      />
    );
  }

  return showSecurityCenter ? (
    <SecurityCenterPage
    onBack={() => {
      setShowSecurityCenter(false);
      void handleChanged();
    }}
    initialSnapshot={{
      settings: walletState.settings,
      biometricUnlock: walletState.settings.biometricUnlock,
      selectedChainId: walletState.selectedChainId,
    }}
  />
  ) : (
    <>

      {settingsConfirmAction === "clear-wallet" ? (
        <div
          role="presentation"
          onClick={() => setSettingsConfirmAction(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "grid",
            alignItems: "end",
            background: "rgba(0, 0, 0, 0.24)",
            padding: "0 0 16px",
            boxSizing: "border-box",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Clear wallet confirmation"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 680,
              margin: "0 auto",
              padding: "0 12px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                border: "1px solid var(--border, #dedede)",
                borderRadius: 24,
                background: "var(--bg, #ffffff)",
                boxShadow: "0 24px 80px rgba(0, 0, 0, 0.18)",
                padding: 18,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  lineHeight: "24px",
                  fontWeight: 850,
                  letterSpacing: "-0.02em",
                }}
              >
                Clear wallet?
              </div>

              <p
                style={{
                  margin: "8px 0 0",
                  color: "var(--text-secondary, #777777)",
                  fontSize: 13,
                  lineHeight: "19px",
                }}
              >
                Your wallet, accounts, imported tokens, local activity, and
                wallet-specific settings will be removed from this browser. Make
                sure your recovery phrase is safely backed up before continuing.
              </p>

              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  className="btn primary lg full"
                  onClick={() => void executeClearWallet()}
                  style={{
                    background: "#a23b2d",
                    borderColor: "#a23b2d",
                  }}
                >
                  Clear wallet
                </button>

                <button
                  type="button"
                  className="btn secondary lg full"
                  onClick={() => setSettingsConfirmAction(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

    <div className="ext-popup" data-screen-label="08 Settings">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack}>
          <BackIcon />
        </button>

        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: "var(--ink-1)",
          }}
        >
          Settings
        </div>

        <span style={{ flex: 1 }} />

        <button className="icbtn" type="button" onClick={onBack}>
          <SettingsIcon />
        </button>
      </div>

      <div className="screen-body">
        <section style={{ padding: "18px 16px 12px" }}>
          <div className="t-h2">
            Wallet
            <br />
            settings
          </div>

          <p
            style={{
              margin: "10px 0 0",
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Manage networks, security, recovery and wallet session.
          </p>
        </section>

        {nativeStatus ? (
          <section
            style={{
              margin: "0 12px 12px",
              padding: "10px 12px",
              borderRadius: 12,
              background: "var(--bg-sunken)",
              color: "var(--ink-2)",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {nativeStatus}
          </section>
        ) : null}

        <section style={{ padding: "0 12px 16px" }}>
          <SectionLabel>Network</SectionLabel>

          <div className="row-list">
            <Row
              icon={<CrosshairIcon />}
              instrument="networks"
              title={getNetworkDisplayName(walletState.selectedChainId)}
              subtitle={activeChain.subtitle}
              value="Change"
              onClick={() => setNetworkSelectorOpen(true)}
            />
          </div>
        </section>

        <section style={{ padding: "0 12px 16px" }}>
          <SectionLabel>Display</SectionLabel>

          <div className="row-list">
            <Row
              icon={<PanelIcon />}
              instrument="settings"
              title="Open side panel"
              subtitle="Use SIMPLE as a slide-out browser panel."
              onClick={() => void openSidePanel()}
            />

            <Row
              icon={<SquareIcon />}
              instrument="settings"
              title="Open full screen"
              subtitle="Open SIMPLE in a dedicated browser tab."
              onClick={openFullscreenApp}
            />
          </div>
        </section>

        <section style={{ padding: "0 12px 16px" }}>
          <SectionLabel>Security</SectionLabel>

          <div className="row-list">
            <Row
              icon={<ShieldIcon />}
              instrument="security"
              title="Security Center"
              subtitle="Review wallet protection and recovery status."
              onClick={() => setShowSecurityCenter(true)}
            />

            <Row
              icon={<ShieldIcon />}
              instrument="security"
              title="Touch ID"
              subtitle="Biometric unlock on this device."
              value={biometricEnabled ? "Enabled" : "Disabled"}
            />

          </div>

          {!biometricEnabled ? (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gap: 10,
              }}
            >
              <input
                className="input lg"
                type="password"
                value={touchIdPassword}
                placeholder="Wallet password"
                autoComplete="current-password"
                onChange={(event) => setTouchIdPassword(event.target.value)}
              />

              <button
                type="button"
                className="btn primary lg full"
                onClick={() => void enableTouchIdUnlock()}
                disabled={saving}
              >
                {saving ? "Enabling…" : "Enable Touch ID"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn secondary lg full"
              onClick={() => void disableTouchIdUnlock()}
              disabled={saving}
              style={{ marginTop: 10 }}
            >
              {saving ? "Disabling…" : "Disable Touch ID"}
            </button>
          )}
        </section>

        <section style={{ padding: "0 12px 16px" }}>
          <SectionLabel>Recovery</SectionLabel>

          <div className="row-list">
            <Row
              icon={<KeyIcon />}
              instrument="security"
              title="Reveal seed phrase"
              subtitle="Show wallet recovery phrase."
              onClick={onRevealSeed}
            />

            <Row
              icon={<KeyIcon />}
              instrument="security"
              title="Reveal private key"
              subtitle="Show selected account private key."
              onClick={onRevealPrivateKey}
            />
          </div>
        </section>

        <section style={{ padding: "0 12px 24px" }}>
          <SectionLabel>Session</SectionLabel>

          <div className="row-list">
            <Row
              icon={<ShieldIcon />}
              instrument="security"
              title="Lock wallet"
              subtitle="Return to unlock screen."
              onClick={() => void lockWallet()}
            />

            <Row
              icon={<TrashIcon />}
              instrument="security"
              title="Clear wallet from browser"
              subtitle="Remove local encrypted wallet data."
              danger
              onClick={() => void clearWallet()}
            />
          </div>
        </section>
      </div>

    </div>
  
    </>
  );
}

export default SettingsPage;
