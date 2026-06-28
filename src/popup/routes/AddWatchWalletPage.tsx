// src/popup/routes/AddWatchWalletPage.tsx

import { useState } from "react";
import { getAddress, isAddress } from "ethers";
import { walletService } from "../../core/wallet/wallet.service";
import { useTranslation } from "../../i18n";

type AddWatchWalletPageProps = {
  onAdded: () => void | Promise<void>;
  onBack: () => void;
};

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <span className="lbl awatch-label">{children}</span>;
}

export function AddWatchWalletPage({
  onAdded,
  onBack,
}: AddWatchWalletPageProps) {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedAddress = address.trim();
  const addressIsValid = isAddress(trimmedAddress);
  const checksumAddress = addressIsValid ? getAddress(trimmedAddress) : null;
  const labelValue = label.trim();

  // Inline address error: shown once something invalid is typed, or when the
  // service rejected the address. Service-level errors (non-address) render
  // separately just above the button.
  const invalidAddressError = t("accounts.invalidEvmAddress");
  const showAddressError =
    error === invalidAddressError ||
    (trimmedAddress.length > 0 && !addressIsValid);
  const serviceError =
    error && error !== invalidAddressError ? error : null;

  async function addWatchWallet() {
    setError(null);

    if (!addressIsValid || !checksumAddress) {
      setError(invalidAddressError);
      return;
    }

    setAdding(true);

    try {
      await walletService.addWatchAccount({
        address: checksumAddress,
        label: labelValue || undefined,
      });

      await onAdded();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className="ext-popup add-watch-page"
      data-screen-label="04 Add Watch Wallet"
    >
      <div className="bar-top">
        <button className="icbtn" type="button" onClick={onBack}>
          <BackIcon />
        </button>

        <div className="awatch-header-title">{t("accounts.watchWallet")}</div>

        <span style={{ flex: 1 }} />

        <span className="awatch-viewonly-pill">{t("accounts.viewOnly")}</span>
      </div>

      <div className="screen-body" style={{ display: "grid", gap: 16 }}>
        {/* Hero: soft circular icon + compact title + one-line subtitle */}
        <section className="awatch-hero">
          <span className="awatch-hero__icon">
            <EyeIcon />
          </span>

          <div className="awatch-hero__text">
            <div className="awatch-hero__title">{t("accounts.watchHeroTitle")}</div>
            <div className="awatch-hero__sub">
              {t("accounts.watchHeroSub")}
            </div>
          </div>
        </section>

        <form
          style={{ display: "grid", gap: 14 }}
          onSubmit={(event) => {
            event.preventDefault();
            void addWatchWallet();
          }}
        >
          <label className="awatch-field">
            <SectionLabel>{t("accounts.walletAddress")}</SectionLabel>

            <div className="awatch-input-wrap">
              <input
                className={`input lg${showAddressError ? " input--error" : ""}`}
                value={address}
                placeholder="0x..."
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setError(null);
                }}
              />

              {addressIsValid ? (
                <span className="awatch-check" aria-label={t("accounts.validAddress")}>
                  <CheckIcon />
                </span>
              ) : null}
            </div>

            {showAddressError ? (
              <div className="send-field-error awatch-field-error">
                {t("accounts.invalidEvmAddress")}
              </div>
            ) : null}
          </label>

          <label className="awatch-field">
            <SectionLabel>{t("accounts.labelOptional")}</SectionLabel>

            <input
              className="input lg"
              value={label}
              placeholder={t("accounts.nameWalletShort")}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setLabel(event.target.value);
                setError(null);
              }}
            />
          </label>

          {/* Compact view-only notice */}
          <section className="awatch-notice">
            <span className="awatch-notice__icon">
              <EyeIcon />
            </span>

            <div className="awatch-notice__body">
              <div className="awatch-notice__title">{t("accounts.viewOnlyTitle")}</div>
              <div className="awatch-notice__text">
                {t("accounts.viewOnlyBody")}
              </div>
            </div>
          </section>

          {serviceError ? (
            <div className="send-field-error awatch-field-error">
              {serviceError}
            </div>
          ) : null}

          <button
            className="btn primary lg full"
            type="submit"
            disabled={!addressIsValid || adding}
          >
            {adding ? t("common.adding") : t("accounts.addWatchButton")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AddWatchWalletPage;
