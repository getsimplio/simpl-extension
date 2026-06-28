// src/popup/components/AccountSelectSheet.tsx
//
// Shared bottom-sheet account selector. Anchors to the wallet card
// (.ext-popup is position: relative), so it overlays correctly in both
// popup and fullscreen surfaces. It does not own any account state — the
// caller selects via the global walletService and re-syncs.

import type {
  WalletAccount,
  WalletAccountId,
} from "../../core/accounts/account.types";
import { useTranslation } from "../../i18n";
import { AccountBlockie } from "./AccountBlockie";

type AccountSelectSheetProps = {
  accounts: WalletAccount[];
  selectedAccountId: WalletAccountId | null;
  busyAccountId?: WalletAccountId | null;
  onSelect: (accountId: WalletAccountId) => void;
  onClose: () => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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

export function AccountSelectSheet({
  accounts,
  selectedAccountId,
  busyAccountId,
  onSelect,
  onClose,
}: AccountSelectSheetProps) {
  const { t } = useTranslation();
  return (
    <div className="account-sheet-backdrop">
      <button
        type="button"
        className="account-sheet-scrim"
        aria-label={t("accounts.closeSelector")}
        onClick={onClose}
      />

      <section
        className="account-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("accounts.selectAccountTitle")}
      >
        <div className="account-sheet-head">
          <div>
            <div className="account-sheet-title">{t("accounts.selectAccountTitle")}</div>
            <div className="account-sheet-subtitle">
              {t("accounts.selectAccountSub")}
            </div>
          </div>

          <button
            type="button"
            className="icbtn"
            aria-label={t("accounts.closeSelector")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="row-list account-sheet-list">
          {accounts.map((account) => {
            const active = account.id === selectedAccountId;
            const pending = busyAccountId === account.id;
            const isWatch = account.type === "watch";

            return (
              <button
                key={account.id}
                type="button"
                className="row account-sheet-row"
                onClick={() => onSelect(account.id)}
                disabled={Boolean(busyAccountId)}
                style={{
                  width: "100%",
                  border: 0,
                  background: active ? "var(--bg-sunken)" : "transparent",
                  textAlign: "left",
                }}
              >
                <AccountBlockie address={account.address} size={38} />

                <div className="body">
                  <div className="nm account-sheet-name">
                    <span className="account-sheet-name-text">
                      {account.label || t("accounts.unnamed")}
                    </span>
                    {isWatch ? (
                      <span className="acct-watch-pill">{t("accounts.watchOnly")}</span>
                    ) : null}
                  </div>
                  <div className="sub">{shortAddress(account.address)}</div>
                </div>

                <div className="num">
                  {pending ? (
                    <span className="account-sheet-pending">···</span>
                  ) : active ? (
                    <span className="account-sheet-check" aria-label={t("common.selected")}>
                      <CheckIcon />
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default AccountSelectSheet;
