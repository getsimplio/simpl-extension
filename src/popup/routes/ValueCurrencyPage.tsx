// src/popup/routes/ValueCurrencyPage.tsx
//
// Full wallet screen for picking the currency portfolio values are shown in
// (USD / USDT / EUR). Replaces the old floating "Select value currency" modal:
// it is rendered inside the .ext-popup card via an early return from HomePage
// (the same pattern as ManageAssetsPage / SelectNetworkPage), never as a
// modal/backdrop/sheet. Selecting a currency saves it and returns to Home; the
// actual persistence + value formatting stay in HomePage (passed via onSelect).

import { t, useTranslation } from "../../i18n";

// Structurally identical to HomePage's ValuationCurrency union, kept local so
// this page has no import cycle with HomePage.
export type ValueCurrency = "USD" | "USDT" | "EUR";

const CURRENCY_META: Record<
  ValueCurrency,
  { symbol: string; bg: string; color: string; descKey: string }
> = {
  USD: { symbol: "$", bg: "var(--warn-soft)", color: "var(--warn)", descKey: "home.currencyUsd" },
  USDT: { symbol: "₮", bg: "var(--secure-soft)", color: "var(--secure)", descKey: "home.currencyUsdt" },
  EUR: { symbol: "€", bg: "var(--info-soft)", color: "#4F46E5", descKey: "home.currencyEur" },
};

const CURRENCY_ORDER: ValueCurrency[] = ["USD", "USDT", "EUR"];

type ValueCurrencyPageProps = {
  selected: ValueCurrency;
  onSelect: (currency: ValueCurrency) => void;
  onBack: () => void;
};

function CurrencyBadge({ currency }: { currency: ValueCurrency }) {
  const { symbol, bg, color } = CURRENCY_META[currency];
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 10,
        background: bg,
        color,
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {symbol}
    </span>
  );
}

function ValueCurrencyPage(props: ValueCurrencyPageProps) {
  // Subscribe to language changes so every string re-renders on switch.
  useTranslation();

  return (
    <div className="ext-popup" data-screen-label="Value Currency">
      <div className="bar-top">
        <button
          className="icbtn"
          type="button"
          onClick={props.onBack}
          aria-label={t("common.back")}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>
        </button>

        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {t("home.valueCurrencyTitle")}
        </div>

        <span style={{ flex: 1 }} />
      </div>

      <div className="screen-body value-currency-body">
        {/* Intro — compact in popup, roomier in fullscreen (scoped CSS). */}
        <section className="value-currency-intro">
          <div className="t-h2 value-currency-title">
            {t("home.valueCurrencyTitle")}
          </div>
          <div className="value-currency-subtitle">
            {t("home.valueCurrencySub")}
          </div>
        </section>

        <div className="row-list" role="listbox" aria-label={t("home.valueCurrencyTitle")}>
          {CURRENCY_ORDER.map((currency) => {
            const isActive = currency === props.selected;
            return (
              <button
                key={currency}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`row value-currency-row${isActive ? " value-currency-row--active" : ""}`}
                onClick={() => props.onSelect(currency)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: 0,
                  textAlign: "left",
                }}
              >
                <CurrencyBadge currency={currency} />
                <div className="body">
                  {/* Ticker codes are never translated; descriptions are. */}
                  <div className="nm">{currency}</div>
                  <div className="sub">{t(CURRENCY_META[currency].descKey as Parameters<typeof t>[0])}</div>
                </div>
                <div className="num">
                  {isActive ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12l5 5L19 7" />
                    </svg>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ValueCurrencyPage;
