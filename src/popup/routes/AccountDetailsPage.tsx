// src/popup/routes/AccountDetailsPage.tsx
//
// Full-screen account detail / management screen opened from the Accounts list.
// Shows account info for any account, supports renaming, and offers quick
// Receive / Send / Swap actions. For IMPORTED signer accounts (private key or
// recovery phrase) it offers a guarded removal flow that actually deletes the
// encrypted secret from the vault (not just a UI hide). No modal / bottom sheet.

import { useEffect, useState } from "react";
import type { WalletAccount } from "../../core/accounts/account.types";
import { isImportedAccount } from "../../core/accounts/account.types";
import {
  getChainById,
  getNetworkDisplayName,
} from "../../core/networks/chain-registry";
import { walletService } from "../../core/wallet/wallet.service";
import type { ExportedPrivateKey } from "../../core/wallet/wallet.types";
import { t, useTranslation } from "../../i18n";
import { AccountBlockie } from "../components/AccountBlockie";

type AccountDetailsPageProps = {
  account: WalletAccount;
  chainId: number;
  // Whether this account is the currently selected/active one.
  isActive: boolean;
  onBack: () => void;
  // Set this account active, then navigate (caller decides where).
  onUseAccount: () => void | Promise<void>;
  // Quick actions — caller switches to this account before navigating.
  onReceive: () => void | Promise<void>;
  onSend: () => void | Promise<void>;
  onSwap: () => void | Promise<void>;
  // Called after a successful rename so the caller can refresh state.
  onRenamed: (account: WalletAccount) => void | Promise<void>;
  // Called after a successful removal; caller refreshes state and navigates.
  onRemoved: () => void | Promise<void>;
  // Primary (seed-derived) accounts cannot be removed individually. This routes
  // the user to Settings → Security Center → Danger Zone to reset wallet data.
  onResetWallet: () => void;
};

type DetailsStep = "details" | "confirm" | "success";

const MAX_LABEL_LENGTH = 32;

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ReceiveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4L4 7l3 3" />
      <path d="M4 7h13" />
      <path d="M17 20l3-3-3-3" />
      <path d="M20 17H7" />
    </svg>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getExportBadge(family: ExportedPrivateKey["family"]): {
  text: string;
  cls: string;
} {
  if (family === "tron") return { text: "TRON", cls: "acct-export-badge--tron" };
  if (family === "shared")
    return { text: "EVM + TRON", cls: "acct-export-badge--shared" };
  return { text: "EVM", cls: "acct-export-badge--evm" };
}

function getSourceLabel(account: WalletAccount): string {
  switch (account.type) {
    case "mnemonic":
      return t("accounts.primary");
    case "importedMnemonic":
      return t("accounts.importedPhrase");
    case "privateKey":
      return t("accounts.importedKey");
    case "watch":
      return t("accounts.watchOnlyAddress");
  }
}

// Copy that doesn't depend on a specific clipboard polyfill.
async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function AccountDetailsPage({
  account,
  chainId,
  isActive,
  onBack,
  onUseAccount,
  onReceive,
  onSend,
  onSwap,
  onRenamed,
  onRemoved,
  onResetWallet,
}: AccountDetailsPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<DetailsStep>("details");
  const [password, setPassword] = useState("");
  const [removing, setRemoving] = useState(false);
  const [usingAccount, setUsingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Inline rename state.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(account.label);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Private key export. Keys live in state ONLY while the reveal screen is open
  // and are cleared on close / account change. Nothing is shown before the
  // password is verified by the service layer.
  const [exportStep, setExportStep] = useState<"hidden" | "password" | "revealed">(
    "hidden",
  );
  const [exportPassword, setExportPassword] = useState("");
  const [exportKeys, setExportKeys] = useState<ExportedPrivateKey[] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);

  // Reset all export state whenever the account changes (and on unmount React
  // drops it), so a revealed key never lingers when leaving the page.
  useEffect(() => {
    setExportStep("hidden");
    setExportPassword("");
    setExportKeys(null);
    setExportError(null);
    setCopiedKeyIndex(null);
  }, [account.id]);

  function openExport() {
    setExportError(null);
    setExportPassword("");
    setExportKeys(null);
    setCopiedKeyIndex(null);
    setExportStep("password");
  }

  // Leave the export flow and wipe any revealed key material from state.
  function closeExport() {
    setExportStep("hidden");
    setExportPassword("");
    setExportKeys(null);
    setExportError(null);
    setCopiedKeyIndex(null);
  }

  async function submitExport() {
    if (!exportPassword || exportBusy) return;

    setExportBusy(true);
    setExportError(null);

    try {
      const result = await walletService.exportAccountKeys({
        accountId: account.id,
        password: exportPassword,
      });
      // Drop the password as soon as it has been used.
      setExportPassword("");
      setExportKeys(result.keys);
      setExportStep("revealed");
    } catch (exportErr) {
      setExportError(
        exportErr instanceof Error ? exportErr.message : String(exportErr),
      );
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCopyKey(index: number, value: string) {
    await copyText(value);
    setCopiedKeyIndex(index);
    window.setTimeout(
      () => setCopiedKeyIndex((current) => (current === index ? null : current)),
      1500,
    );
  }

  const imported = isImportedAccount(account);
  const isWatch = account.type === "watch";
  const isPrivateKey = account.type === "privateKey";
  // Primary = seed-derived wallet. It can never be removed individually; the only
  // way to remove it is a full wallet reset in the Security Center Danger Zone.
  const isPrimary = account.type === "mnemonic";
  // Accounts that can be removed individually through the normal guarded flow:
  // imported signers (private key / recovery phrase) and watch-only addresses.
  const isRemovable = imported || isWatch;
  const badge = isWatch
    ? { label: t("accounts.watchOnly"), kind: "watch" as const }
    : imported
      ? { label: t("accounts.imported"), kind: "imported" as const }
      : null;

  const explorerBase = getChainById(chainId)?.blockExplorerUrl ?? null;
  const networkLabel = getNetworkDisplayName(chainId);

  // Removal copy. Wording deliberately avoids "delete account" so it never reads
  // as deleting anything on-chain — removal is local to this device only.
  const removeButtonLabel = isWatch
    ? t("accounts.removeWatchOnly")
    : t("accounts.removeFromSimpl");
  const removeHelp = isWatch
    ? t("accounts.removeWatchOnlyHelp")
    : t("accounts.removeAccountHelp");
  const confirmTitle = isWatch
    ? t("accounts.removeWatchOnlyConfirm")
    : t("accounts.removeAccountConfirm");
  const confirmBody = isWatch
    ? t("accounts.removeWatchOnlyBody")
    : t("accounts.removeAccountBody");

  async function handleCopy() {
    await copyText(account.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function startRename() {
    setNameDraft(account.label);
    setNameError(null);
    setEditingName(true);
  }

  function cancelRename() {
    setEditingName(false);
    setNameError(null);
    setNameDraft(account.label);
  }

  async function saveRename() {
    const next = nameDraft.trim();

    if (!next) {
      setNameError(t("accounts.nameEmpty"));
      return;
    }
    if (next.length > MAX_LABEL_LENGTH) {
      setNameError(t("accounts.nameTooLong", { max: MAX_LABEL_LENGTH }));
      return;
    }
    if (next === account.label) {
      setEditingName(false);
      return;
    }

    setSavingName(true);
    setNameError(null);
    try {
      const result = await walletService.renameAccount({
        accountId: account.id,
        label: next,
      });
      setEditingName(false);
      await onRenamed(result.account);
    } catch (renameError) {
      setNameError(
        renameError instanceof Error ? renameError.message : String(renameError),
      );
    } finally {
      setSavingName(false);
    }
  }

  async function handleUseAccount() {
    setUsingAccount(true);
    try {
      await onUseAccount();
    } finally {
      setUsingAccount(false);
    }
  }

  async function handleRemove() {
    setError(null);

    if (!password) {
      setError(t("accounts.passwordToRemove"));
      return;
    }

    setRemoving(true);
    try {
      // Watch-only accounts hold no key material; imported signers drop their
      // encrypted secret from the vault. Both verify the password first, and
      // neither touches the primary seed or any other account.
      if (isWatch) {
        await walletService.removeWatchAccount({
          accountId: account.id,
          password,
        });
      } else {
        await walletService.removeImportedAccount({
          accountId: account.id,
          password,
        });
      }
      setPassword("");
      setStep("success");
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : String(removeError),
      );
    } finally {
      setRemoving(false);
    }
  }

  // ── Success ──
  if (step === "success") {
    return (
      <div className="ext-popup acct-details-page" data-screen-label="Account removed">
        <div className="bar-top">
          <span style={{ width: 32, flexShrink: 0 }} />
          <span className="acct-details-title">{t("accounts.removed")}</span>
          <span style={{ width: 32, flexShrink: 0 }} />
        </div>
        <div className="screen-body acct-details-body">
          <div className="acct-details-success">
            <div className="acct-details-success__check" aria-hidden="true">✓</div>
            <div className="acct-details-success__title">
              {isWatch ? t("accounts.watchOnlyRemoved") : t("accounts.accountRemoved")}
            </div>
            <div className="acct-details-success__sub">
              {isWatch
                ? "The address was removed from simpl on this device. You can add it again later."
                : "The account was removed from simpl on this device only. Funds on-chain are unaffected."}
            </div>
          </div>
          <button
            className="btn primary lg full"
            type="button"
            onClick={() => void onRemoved()}
          >
            {t("common.done")}
          </button>
        </div>
      </div>
    );
  }

  // ── Confirm removal ──
  if (step === "confirm") {
    return (
      <div className="ext-popup acct-details-page" data-screen-label="Confirm remove">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={() => {
              setError(null);
              setPassword("");
              setStep("details");
            }}
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>
          <span className="acct-details-title">{confirmTitle}</span>
          <span style={{ width: 32, flexShrink: 0 }} />
        </div>

        <div className="screen-body acct-details-body">
          <div className="acct-details-danger-card">{confirmBody}</div>

          <div className="acct-details-field">
            <label className="acct-details-field-label" htmlFor="acct-remove-pwd">
              {t("common.walletPassword")}
            </label>
            <input
              id="acct-remove-pwd"
              className="import-acct-input"
              type="password"
              placeholder={t("common.enterWalletPassword")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            <p className="acct-details-help">
              {t("accounts.passwordToRemoveHelp")}
            </p>
          </div>

          {error ? <div className="send-field-error">{error}</div> : null}

          <div className="acct-details-confirm-actions">
            <button
              className="btn secondary lg full"
              type="button"
              disabled={removing}
              onClick={() => {
                setError(null);
                setPassword("");
                setStep("details");
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              className="acct-danger-btn"
              type="button"
              disabled={removing || !password}
              onClick={() => void handleRemove()}
            >
              {removing ? t("common.removing") : removeButtonLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Export private key (password → reveal) ──
  if (exportStep !== "hidden") {
    return (
      <div className="ext-popup acct-details-page" data-screen-label="Export key">
        <div className="bar-top">
          <button
            className="icbtn"
            type="button"
            onClick={closeExport}
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>
          <span className="acct-details-title">{t("accounts.exportPrivateKey")}</span>
          <span style={{ width: 32, flexShrink: 0 }} />
        </div>

        <div className="screen-body acct-details-body">
          <div className="acct-details-danger-card">
            Anyone with this private key has full control of this account's
            funds. Never share it, and never enter it on any website.
          </div>

          {exportStep === "password" ? (
            <>
              <div className="acct-details-field">
                <label
                  className="acct-details-field-label"
                  htmlFor="acct-export-pwd"
                >
                  {t("common.walletPassword")}
                </label>
                <input
                  id="acct-export-pwd"
                  className="import-acct-input"
                  type="password"
                  placeholder={t("common.enterWalletPassword")}
                  value={exportPassword}
                  autoComplete="current-password"
                  onChange={(event) => {
                    setExportPassword(event.target.value);
                    setExportError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitExport();
                  }}
                />
                <p className="acct-details-help">
                  {t("accounts.exportPasswordHelp")}
                </p>
              </div>

              {exportError ? (
                <div className="send-field-error">{exportError}</div>
              ) : null}

              <button
                className="acct-danger-outline-btn"
                type="button"
                disabled={exportBusy || !exportPassword}
                onClick={() => void submitExport()}
              >
                {exportBusy ? t("common.verifying") : t("accounts.revealPrivateKey")}
              </button>
            </>
          ) : null}

          {exportStep === "revealed" && exportKeys ? (
            <>
              {exportKeys.map((key, index) => {
                const badge = getExportBadge(key.family);
                const isCopied = copiedKeyIndex === index;

                return (
                  <div
                    className="acct-details-address-card"
                    key={`${key.family}-${index}`}
                  >
                    <div className="acct-export-key__head">
                      <span className={`acct-export-badge ${badge.cls}`}>
                        {badge.text}
                      </span>
                      <span className="acct-export-key__label">{key.label}</span>
                      <button
                        className={`acct-addr-btn acct-export-key__copy${
                          isCopied ? " acct-addr-copied" : ""
                        }`}
                        type="button"
                        onClick={() => void handleCopyKey(index, key.privateKey)}
                        aria-label={t("accounts.copyKey", { label: key.label })}
                        title={isCopied ? t("common.copied") : t("accounts.copyKeyShort")}
                      >
                        {isCopied ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    </div>

                    <div className="acct-details-address-value">
                      {key.privateKey}
                    </div>

                    {key.note ? (
                      <p className="acct-export-note">{key.note}</p>
                    ) : null}
                  </div>
                );
              })}

              <p className="acct-details-help">
                Store these keys offline. Closing this screen clears them from
                view.
              </p>

              <button
                className="btn secondary lg full"
                type="button"
                onClick={closeExport}
              >
                {t("common.done")}
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Details ──
  return (
    <div className="ext-popup acct-details-page" data-screen-label="Account">
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>
        <span className="acct-details-title">{t("common.account")}</span>
        <span style={{ width: 32, flexShrink: 0 }} />
      </div>

      <div className="screen-body acct-details-body">
        <div className="acct-details-hero">
          <AccountBlockie address={account.address} size={56} />

          {editingName ? (
            <div className="acct-rename">
              <input
                className="acct-rename-input"
                type="text"
                value={nameDraft}
                maxLength={MAX_LABEL_LENGTH}
                autoFocus
                placeholder={t("common.accountName")}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveRename();
                  if (event.key === "Escape") cancelRename();
                }}
              />
              <div className="acct-rename-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={savingName}
                  onClick={cancelRename}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="btn primary"
                  type="button"
                  disabled={savingName || !nameDraft.trim()}
                  onClick={() => void saveRename()}
                >
                  {savingName ? t("common.saving") : t("common.save")}
                </button>
              </div>
              {nameError ? (
                <div className="acct-rename-error">{nameError}</div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="acct-details-hero__name">
                <span className="acct-details-hero__name-text">
                  {account.label}
                </span>
                <button
                  className="acct-rename-btn"
                  type="button"
                  onClick={startRename}
                  aria-label={t("accounts.renameAccount")}
                >
                  <PencilIcon />
                </button>
              </div>
              <div className="acct-details-hero__meta">
                <span className="acct-details-hero__source">
                  {getSourceLabel(account)}
                </span>
                {badge ? (
                  <span
                    className={
                      badge.kind === "watch"
                        ? "acct-watch-pill"
                        : "acct-imported-pill"
                    }
                  >
                    {badge.label}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Activation — explicit (no instant switching from the list) */}
        {isActive ? (
          <div className="acct-details-active-card">
            <span className="acct-details-active-dot" aria-hidden="true" />
            {t("accounts.activeAccount")}
          </div>
        ) : (
          <button
            className="btn primary lg full"
            type="button"
            disabled={usingAccount}
            onClick={() => void handleUseAccount()}
          >
            {usingAccount ? t("common.switching") : t("accounts.useAccount")}
          </button>
        )}

        {/* Quick actions */}
        <div className="acct-quick-actions">
          <button
            className="acct-quick-btn"
            type="button"
            onClick={() => void onReceive()}
          >
            <span className="acct-quick-btn__icon"><ReceiveIcon /></span>
            {t("home.receive")}
          </button>

          {!isWatch ? (
            <>
              <button
                className="acct-quick-btn"
                type="button"
                onClick={() => void onSend()}
              >
                <span className="acct-quick-btn__icon"><SendIcon /></span>
                {t("home.send")}
              </button>
              <button
                className="acct-quick-btn"
                type="button"
                onClick={() => void onSwap()}
              >
                <span className="acct-quick-btn__icon"><SwapIcon /></span>
                {t("home.swap")}
              </button>
            </>
          ) : null}
        </div>

        {isWatch ? (
          <p className="acct-details-help">
            {t("accounts.watchOnlyLimitation")}
          </p>
        ) : null}

        {/* Info card */}
        <div className="acct-details-info-card">
          <div className="acct-details-info-row">
            <span className="acct-details-info-label">{t("common.type")}</span>
            <span className="acct-details-info-value">
              {isWatch ? t("accounts.watchOnly") : t("accounts.signer")}
            </span>
          </div>
          <div className="acct-details-info-row">
            <span className="acct-details-info-label">{t("common.source")}</span>
            <span className="acct-details-info-value">
              {getSourceLabel(account)}
            </span>
          </div>
          <div className="acct-details-info-row">
            <span className="acct-details-info-label">{t("common.address")}</span>
            <span className="acct-details-info-value acct-details-info-mono">
              {shortAddress(account.address)}
            </span>
          </div>
          <div className="acct-details-info-row">
            <span className="acct-details-info-label">{t("common.network")}</span>
            <span className="acct-details-info-value">{networkLabel}</span>
          </div>
        </div>

        {/* Full address */}
        <div className="acct-details-address-card">
          <div className="acct-details-address-label">{t("common.fullAddress")}</div>
          <div className="acct-details-address-value">{account.address}</div>

          <div className="acct-details-actions">
            <button
              className={`btn secondary lg full${copied ? " acct-details-copied" : ""}`}
              type="button"
              onClick={() => void handleCopy()}
            >
              <CopyIcon />
              {copied ? t("common.copied") : t("common.copyAddress")}
            </button>

            {explorerBase ? (
              <a
                className="btn secondary lg full"
                href={`${explorerBase}/address/${account.address}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("common.viewOnExplorerArrow")}
              </a>
            ) : null}
          </div>
        </div>

        {/* Export private key — signer accounts only (hidden for watch-only).
            Most sensitive action → strongest (outlined red) treatment. */}
        {!isWatch ? (
          <div className="acct-details-remove">
            <button
              className="acct-danger-outline-btn"
              type="button"
              onClick={openExport}
            >
              {t("accounts.exportPrivateKey")}
            </button>
            <p className="acct-details-help">
              {isPrivateKey
                ? t("accounts.exportHelpImported")
                : t("accounts.exportHelpMnemonic")}
            </p>
          </div>
        ) : null}

        {/* Remove from simpl — imported signers + watch-only. Destructive but a
            quieter treatment than Export private key (it only removes locally). */}
        {isRemovable ? (
          <div className="acct-details-remove">
            <button
              className="acct-remove-subtle-btn"
              type="button"
              onClick={() => {
                setError(null);
                setStep("confirm");
              }}
            >
              {removeButtonLabel}
            </button>
            <p className="acct-details-help">{removeHelp}</p>
          </div>
        ) : null}

        {/* Primary seed account — cannot be removed individually. Point the user
            to the Danger Zone for a full wallet reset instead. */}
        {isPrimary ? (
          <div className="acct-details-remove">
            <button
              className="acct-remove-subtle-btn"
              type="button"
              onClick={onResetWallet}
            >
              {t("accounts.resetWalletData")}
            </button>
            <p className="acct-details-help">
              {t("accounts.primaryCannotRemove")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AccountDetailsPage;
