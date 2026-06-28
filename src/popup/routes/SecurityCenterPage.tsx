import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import { useTranslation } from "../../i18n";
import { suppressBiometricAutoPromptOnce } from "../biometric-autoprompt";
import { BiometricUnlockRow } from "../components/BiometricUnlockRow";

import SeedBackupVerificationPage from "./SeedBackupVerificationPage";
import ConnectedSitesPage from "./ConnectedSitesPage";

type Snapshot = Record<string, unknown>;

type SecurityCenterPageProps = {
  onBack?: () => void;
  initialSnapshot?: Snapshot;
  // Live wallet state + change notifier, used by the biometric unlock control
  // (capability detection + secure enroll/disable). Optional so the page still
  // renders if a caller omits them; the biometric row simply won't show.
  walletState?: WalletState;
  onChanged?: () => void | Promise<void>;
  // Destructive wallet removal, owned by the caller (Settings) so the deletion
  // behaviour stays identical to before. The Danger Zone UI + confirmation live
  // here; this fires the actual clear after the user confirms.
  onClearWallet?: () => void | Promise<void>;
  // When true (deep-linked from "Reset wallet data" on a primary account),
  // scroll the Danger Zone into view on mount instead of starting at the top.
  focusDanger?: boolean;
};

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60] as const;

function getChrome() {
  return (globalThis as unknown as { chrome?: any }).chrome;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readLocalStorageSnapshot(): Record<string, unknown> {
  const storage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  if (!storage) {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (!key) {
      continue;
    }

    const value = storage.getItem(key);
    result[key] = value == null ? value : parseMaybeJson(value);
  }

  return result;
}

function getByPath(source: Snapshot, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, source);
}

function firstBoolean(source: Snapshot, paths: string[]): boolean | undefined {
  for (const path of paths) {
    const value = getByPath(source, path);

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      if (value.toLowerCase() === "true") {
        return true;
      }

      if (value.toLowerCase() === "false") {
        return false;
      }
    }
  }

  return undefined;
}

function firstNumber(source: Snapshot, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getByPath(source, path);

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function hasAny(source: Snapshot, paths: string[]): boolean {
  return paths.some((path) => {
    const value = getByPath(source, path);

    if (value == null) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }

    return true;
  });
}

function chromeStorageGetAll(): Promise<Record<string, unknown>> {
  const chrome = getChrome();

  if (!chrome?.storage?.local?.get) {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(null, (items: Record<string, unknown>) => {
        if (chrome.runtime?.lastError) {
          resolve({});
          return;
        }

        resolve(items ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  const chrome = getChrome();

  if (!chrome?.storage?.local?.set) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(items, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function readSnapshot(): Promise<Snapshot> {
  const chromeStorage = await chromeStorageGetAll();
  const localStorageSnapshot = readLocalStorageSnapshot();

  return {
    ...chromeStorage,
    __localStorage: localStorageSnapshot,
  };
}

function mergeSnapshots(storageSnapshot: Snapshot, initialSnapshot: Snapshot): Snapshot {
  const initialWalletState = asRecord(initialSnapshot.walletState);
  const storageWalletState = asRecord(storageSnapshot.walletState);

  const initialWalletStateSettings = asRecord(initialWalletState.settings);
  const storageWalletStateSettings = asRecord(storageWalletState.settings);

  const initialSettings = asRecord(initialSnapshot.settings);
  const storageSettings = asRecord(storageSnapshot.settings);

  // Important: storage wins over initialSnapshot.
  // initialSnapshot comes from SettingsPage and may be stale after local changes.
  const settings = {
    ...initialWalletStateSettings,
    ...initialSettings,
    ...storageWalletStateSettings,
    ...storageSettings,
  };

  const securitySettings = {
    ...asRecord(initialSnapshot.securitySettings),
    ...asRecord(storageSnapshot.securitySettings),
  };

  return {
    ...initialSnapshot,
    ...storageSnapshot,
    settings,
    securitySettings,
    walletState: {
      ...initialWalletState,
      ...storageWalletState,
      settings,
    },
    biometricUnlock:
      storageSnapshot.biometricUnlock ??
      initialSnapshot.biometricUnlock ??
      settings.biometricUnlock,
  };
}

async function updateSecuritySettings(patch: Record<string, unknown>): Promise<Snapshot> {
  const current = await readSnapshot();

  const securitySettings = {
    ...asRecord(current.securitySettings),
    ...patch,
  };

  const currentSettings = asRecord(current.settings);
  const currentSettingsSecurity = asRecord(currentSettings.security);

  const nextSettings =
    Object.keys(currentSettings).length > 0
      ? {
          ...currentSettings,
          security: {
            ...currentSettingsSecurity,
            ...patch,
          },
        }
      : current.settings;

  const payload: Record<string, unknown> = {
    securitySettings,
  };

  if (nextSettings) {
    payload.settings = nextSettings;
  }

  await chromeStorageSet(payload);

  try {
    localStorage.setItem("securitySettings", JSON.stringify(securitySettings));
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }

  return readSnapshot();
}

async function updateRootSettings(
  patch: Record<string, unknown>,
  baseSnapshot: Snapshot = {},
): Promise<Snapshot> {
  const storageSnapshot = await readSnapshot();
  const mergedSnapshot = mergeSnapshots(storageSnapshot, baseSnapshot);

  const walletState = asRecord(mergedSnapshot.walletState);
  const walletStateSettings = asRecord(walletState.settings);

  const nextSettings = {
    ...walletStateSettings,
    ...asRecord(mergedSnapshot.settings),
    ...patch,
  };

  const payload: Record<string, unknown> = {
    settings: nextSettings,
  };

  if (Object.keys(walletState).length > 0) {
    payload.walletState = {
      ...walletState,
      settings: {
        ...walletStateSettings,
        ...nextSettings,
      },
    };
  }

  await chromeStorageSet(payload);

  try {
    localStorage.setItem("settings", JSON.stringify(nextSettings));

    if (payload.walletState) {
      localStorage.setItem("walletState", JSON.stringify(payload.walletState));
    }
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }

  const nextSnapshot = await readSnapshot();

  return mergeSnapshots(nextSnapshot, {
    ...baseSnapshot,
    settings: nextSettings,
    walletState: payload.walletState ?? {
      settings: nextSettings,
    },
  });
}

type RowTone = "neutral" | "secure" | "warn" | "danger";
type PillTone = "secure" | "warn" | "danger" | "neutral";

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function Chevron() {
  return (
    <svg
      className="set-row__chev"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
      <path d="M9.5 12l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function DocShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V3.5z" />
      <path d="M13 3.5V9h5" />
      <path d="M9.5 14l2 2 3-3.4" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l16 16" />
      <path d="M9.9 5.2A9 9 0 0 1 12 5c5 0 9 5 9 7a12 12 0 0 1-2.2 2.8M6.4 7.6A12.6 12.6 0 0 0 3 12c0 2 4 7 9 7a8.8 8.8 0 0 0 3.3-.6" />
      <path d="M9.8 10.2a3 3 0 0 0 4 4.2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 14.5l5-5" />
      <path d="M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2" />
      <path d="M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
    </svg>
  );
}

function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`set-row__pill set-row__pill--${tone}`}>{children}</span>;
}

function Toggle({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`set-toggle${checked ? " set-toggle--on" : ""}`}
      onClick={onClick}
    >
      <span className="set-toggle__knob" />
    </button>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section__label">{label}</div>
      <div className="set-card">{children}</div>
    </section>
  );
}

// Clickable row (full-width button) with a tinted icon + right-side affordance.
function ActionRow({
  icon,
  tone = "neutral",
  title,
  subtitle,
  aside,
  onClick,
}: {
  icon: ReactNode;
  tone?: RowTone;
  title: string;
  subtitle: string;
  aside?: ReactNode;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button type="button" className="set-row" onClick={() => void onClick()}>
      <span className={`set-row__icon set-row__icon--${tone}`}>{icon}</span>
      <span className="set-row__body">
        <span className="set-row__title">{title}</span>
        <span className="set-row__sub">{subtitle}</span>
      </span>
      <span className="set-row__aside">{aside ?? <Chevron />}</span>
    </button>
  );
}

// Status-only / control row (not a navigation button).
function StatusRow({
  icon,
  tone = "neutral",
  title,
  subtitle,
  aside,
}: {
  icon: ReactNode;
  tone?: RowTone;
  title: string;
  subtitle: string;
  aside: ReactNode;
}) {
  return (
    <div className="set-row set-row--static">
      <span className={`set-row__icon set-row__icon--${tone}`}>{icon}</span>
      <span className="set-row__body">
        <span className="set-row__title">{title}</span>
        <span className="set-row__sub">{subtitle}</span>
      </span>
      <span className="set-row__aside">{aside}</span>
    </div>
  );
}

export default function SecurityCenterPage({
  onBack,
  initialSnapshot = {},
  onClearWallet,
  focusDanger = false,
  walletState,
  onChanged,
}: SecurityCenterPageProps) {
  const { t } = useTranslation();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const dangerRef = useRef<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [showSeedBackupVerification, setShowSeedBackupVerification] = useState(false);
  const [isAutoLockSheetOpen, setIsAutoLockSheetOpen] = useState(false);
  const [showConnectedSites, setShowConnectedSites] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    // Deep-linked from "Reset wallet data": reveal the Danger Zone. Otherwise
    // start at the top like a normal page open.
    if (focusDanger && dangerRef.current) {
      dangerRef.current.scrollIntoView({ block: "center" });
      return;
    }
    pageRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [focusDanger]);

  useEffect(() => {
    let isMounted = true;

    readSnapshot().then((nextSnapshot) => {
      if (!isMounted) {
        return;
      }

      setSnapshot(mergeSnapshots(nextSnapshot, initialSnapshot));
    });

    return () => {
      isMounted = false;
    };
  }, [initialSnapshot]);

  const securityState = useMemo(() => {
    const encryptedVaultExists = hasAny(snapshot, [
      "encryptedVault",
      "vault.encryptedVault",
      "vault.ciphertext",
      "walletVault",
      "encryptedWallet",
      "__localStorage.encryptedVault",
      "__localStorage.walletVault",
      "__localStorage.encryptedWallet",
    ]);

    const autoLockMinutes = firstNumber(snapshot, [
      "settings.autoLockMinutes",
      "walletState.settings.autoLockMinutes",
      "walletSettings.autoLockMinutes",
      "securitySettings.autoLockMinutes",
      "autoLockMinutes",
      "__localStorage.settings.autoLockMinutes",
      "__localStorage.walletSettings.autoLockMinutes",
    ]);

    const seedBackupConfirmed = firstBoolean(snapshot, [
      "securitySettings.seedBackupConfirmed",
      "settings.security.seedBackupConfirmed",
      "walletState.settings.security.seedBackupConfirmed",
      "seedBackupConfirmed",
      "__localStorage.securitySettings.seedBackupConfirmed",
      "__localStorage.settings.security.seedBackupConfirmed",
    ]);

    const seedBackupVerified = firstBoolean(snapshot, [
      "securitySettings.seedBackupVerified",
      "settings.security.seedBackupVerified",
      "walletState.settings.security.seedBackupVerified",
      "seedBackupVerified",
      "__localStorage.securitySettings.seedBackupVerified",
      "__localStorage.settings.security.seedBackupVerified",
    ]);

    const hideBalances = firstBoolean(snapshot, [
      "settings.hideBalances",
      "walletState.settings.hideBalances",
      "walletSettings.hideBalances",
      "hideBalances",
      "__localStorage.settings.hideBalances",
      "__localStorage.walletSettings.hideBalances",
    ]);

    const rawConnectedSites = snapshot["connectedSites"];
    const connectedSitesCount = Array.isArray(rawConnectedSites)
      ? (rawConnectedSites as unknown[]).length
      : 0;

    return {
      encryptedVaultExists,
      autoLockMinutes,
      seedBackupConfirmed,
      seedBackupVerified,
      hideBalances,
      connectedSitesCount,
    };
  }, [snapshot]);

  const handleSeedBackupVerified = async () => {
    const nextSnapshot = await updateSecuritySettings({
      seedBackupConfirmed: true,
      seedBackupConfirmedAt: new Date().toISOString(),
      seedBackupVerified: true,
      seedBackupVerifiedAt: new Date().toISOString(),
    });

    setSnapshot(mergeSnapshots(nextSnapshot, initialSnapshot));
    setShowSeedBackupVerification(false);
  };

  const changeAutoLock = () => {
    setIsAutoLockSheetOpen(true);
  };

  const applyAutoLock = async (minutes: number) => {
    const nextSnapshot = await updateRootSettings(
      {
        autoLockMinutes: minutes,
      },
      initialSnapshot,
    );

    setSnapshot(nextSnapshot);
    setIsAutoLockSheetOpen(false);
  };

  const toggleHideBalances = async () => {
    const nextHideBalances = securityState.hideBalances !== true;

    const nextSnapshot = await updateRootSettings(
      {
        hideBalances: nextHideBalances,
      },
      initialSnapshot,
    );

    setSnapshot(nextSnapshot);
  };

  const lockWallet = async () => {
    // User-initiated lock: suppress the one-shot biometric auto-prompt on the
    // unlock screen we are about to show (explicit tap still works).
    suppressBiometricAutoPromptOnce();
    walletService.lockWallet();

    window.dispatchEvent(
      new CustomEvent("simple-wallet:lock", {
        detail: {
          source: "security-center",
        },
      }),
    );

    onBack?.();
  };

  if (showConnectedSites) {
    return <ConnectedSitesPage onBack={() => setShowConnectedSites(false)} />;
  }

  if (showSeedBackupVerification) {
    return (
      <SeedBackupVerificationPage
        onBack={() => setShowSeedBackupVerification(false)}
        onVerified={handleSeedBackupVerified}
      />
    );
  }

  const verified = securityState.seedBackupVerified === true;
  const hideBalances = securityState.hideBalances === true;
  const connectedCount = securityState.connectedSitesCount;
  const autoLockLabel =
    typeof securityState.autoLockMinutes === "number"
      ? t("common.minutesShort", { minutes: securityState.autoLockMinutes })
      : t("common.notSet");

  return (
    <div
      className="ext-popup settings-page security-center-page"
      data-screen-label="Security Center"
    >
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>
        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {t("security.centerTitle")}
        </div>
        <span style={{ flex: 1 }} />
        <span className="reveal-bar-icon" aria-hidden="true">
          <ShieldIcon />
        </span>
      </div>

      <div className="screen-body settings-body" ref={pageRef}>
        <header className="set-hero">
          <div className="set-hero__title">{t("security.heroTitle")}</div>
          <div className="set-hero__sub">
            {t("security.heroSub")}
          </div>
        </header>

        <div className="set-grid">
          <Section label={t("security.section.device")}>
            {/* Biometric unlock — self-hides on unsupported devices. */}
            {walletState && onChanged ? (
              <BiometricUnlockRow
                walletState={walletState}
                onChanged={onChanged}
              />
            ) : null}

            <ActionRow
              icon={<ClockIcon />}
              tone="neutral"
              title={t("security.autoLock")}
              subtitle={t("security.autoLockSub")}
              aside={
                <>
                  <span className="set-row__value">{autoLockLabel}</span>
                  <Chevron />
                </>
              }
              onClick={changeAutoLock}
            />

            <ActionRow
              icon={<LockIcon />}
              tone="neutral"
              title={t("security.lockWallet")}
              subtitle={t("security.lockWalletSub")}
              onClick={lockWallet}
            />
          </Section>

          <Section label={t("security.section.recovery")}>
            <ActionRow
              icon={<DocShieldIcon />}
              tone={verified ? "secure" : "warn"}
              title={t("security.recoveryBackup")}
              subtitle={
                verified
                  ? t("security.recoveryVerified")
                  : t("security.recoveryPending")
              }
              aside={
                <Pill tone={verified ? "secure" : "warn"}>
                  {verified ? t("security.verified") : t("security.actionNeeded")}
                </Pill>
              }
              onClick={() => setShowSeedBackupVerification(true)}
            />
          </Section>

          <Section label={t("security.section.privacy")}>
            <StatusRow
              icon={<EyeOffIcon />}
              tone="neutral"
              title={t("security.hideBalances")}
              subtitle={
                hideBalances
                  ? t("security.hideBalancesOn")
                  : t("security.hideBalancesOff")
              }
              aside={
                <Toggle
                  checked={hideBalances}
                  onClick={() => void toggleHideBalances()}
                  label={t("security.hideBalancesToggle")}
                />
              }
            />

            <ActionRow
              icon={<LinkIcon />}
              tone="neutral"
              title={t("security.connectedSites")}
              subtitle={t("security.connectedSitesSub")}
              aside={
                <>
                  <Pill tone="neutral">{connectedCount}</Pill>
                  <Chevron />
                </>
              }
              onClick={() => setShowConnectedSites(true)}
            />
          </Section>
        </div>

        {onClearWallet ? (
          <section className="set-danger" ref={dangerRef}>
            <div className="set-danger__head">
              <div className="set-danger__title">{t("security.dangerZone")}</div>
              <div className="set-danger__desc">
                {t("security.dangerZoneDesc")}
              </div>
            </div>

            <button
              type="button"
              className="set-danger__row"
              onClick={() => setConfirmClear(true)}
            >
              <span className="set-row__icon set-row__icon--danger">
                <TrashIcon />
              </span>

              <span className="set-row__body">
                <span className="set-row__title">{t("security.clearWallet")}</span>
                <span className="set-row__sub">
                  {t("security.clearWalletSub")}
                </span>
              </span>

              <span className="set-row__aside">
                <Chevron />
              </span>
            </button>
          </section>
        ) : null}
      </div>

      {isAutoLockSheetOpen ? (
        <div
          role="presentation"
          onClick={() => setIsAutoLockSheetOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
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
            aria-label={t("security.autoLockOptions")}
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
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  alignItems: "start",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      lineHeight: "24px",
                      fontWeight: 850,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {t("security.autoLock")}
                  </div>

                  <div
                    style={{
                      marginTop: 4,
                      color: "var(--text-secondary, #777777)",
                      fontSize: 13,
                      lineHeight: "19px",
                    }}
                  >
                    {t("security.autoLockDesc")}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={t("security.closeAutoLock")}
                  onClick={() => setIsAutoLockSheetOpen(false)}
                  style={{
                    width: 36,
                    height: 36,
                    border: "1px solid var(--border, #dedede)",
                    borderRadius: 999,
                    background: "var(--bg, #ffffff)",
                    color: "var(--text-primary, #111111)",
                    cursor: "pointer",
                    fontSize: 20,
                    lineHeight: "20px",
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </div>

              <div className="set-card">
                {AUTO_LOCK_OPTIONS.map((minutes) => {
                  const selected = securityState.autoLockMinutes === minutes;

                  return (
                    <button
                      key={minutes}
                      type="button"
                      className="set-row"
                      onClick={() => void applyAutoLock(minutes)}
                    >
                      <span className="set-row__body">
                        <span className="set-row__title">
                          {t("common.minutesShort", { minutes })}
                        </span>
                        <span className="set-row__sub">
                          {minutes <= 5
                            ? t("security.autoLockTipHigh")
                            : minutes <= 15
                              ? t("security.autoLockTipMedium")
                              : t("security.autoLockTipLow")}
                        </span>
                      </span>
                      <span className="set-row__aside">
                        {selected ? (
                          <Pill tone="secure">{t("common.selected")}</Pill>
                        ) : (
                          <Chevron />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn secondary lg full"
                onClick={() => setIsAutoLockSheetOpen(false)}
                style={{ marginTop: 12 }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {confirmClear ? (
        <div
          role="presentation"
          onClick={() => setConfirmClear(false)}
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
            aria-label={t("security.clearConfirmLabel")}
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
                {t("security.clearConfirmTitle")}
              </div>

              <p
                style={{
                  margin: "8px 0 0",
                  color: "var(--text-secondary, #777777)",
                  fontSize: 13,
                  lineHeight: "19px",
                }}
              >
                {t("security.clearConfirmBody")}
              </p>

              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  className="btn primary lg full"
                  onClick={() => {
                    setConfirmClear(false);
                    void onClearWallet?.();
                  }}
                  style={{
                    background: "var(--danger)",
                    borderColor: "var(--danger)",
                  }}
                >
                  {t("security.clearWallet")}
                </button>

                <button
                  type="button"
                  className="btn secondary lg full"
                  onClick={() => setConfirmClear(false)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
