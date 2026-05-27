// src/popup/routes/WelcomePage.tsx

type WelcomePageProps = {
  onCreateWallet: () => void;
  onImportWallet: () => void;
  onAddWatchWallet: () => void;
};

function LogoMark() {
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 10,
        background:
          "linear-gradient(135deg, var(--ink-1) 0%, var(--ink-1) 100%)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-on-dark)",
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: "-0.04em",
      }}
    >
      S
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function WatchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
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

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l7 3v5c0 4.5-2.8 8.5-7 10-4.2-1.5-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function WelcomePage({
  onCreateWallet,
  onImportWallet,
  onAddWatchWallet,
}: WelcomePageProps) {
  return (
    <div className="ext-popup" data-screen-label="01 Welcome">
      <div className="bar-top">
        <LogoMark />

        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-1)",
          }}
        >
          SIMPLE
        </div>

        <span style={{ flex: 1 }} />

        <span
          className="pill"
          style={{
            background: "var(--bg-surface)",
            color: "var(--ink-3)",
          }}
        >
          EVM
        </span>
      </div>

      <div
        className="screen-body"
        style={{
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 18,
        }}
      >
        <section style={{ paddingTop: 18 }}>
          <div
            className="lbl"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Non-custodial wallet
          </div>

          <div
            className="t-h2"
            style={{
              fontSize: 36,
              lineHeight: 0.96,
              letterSpacing: "-0.06em",
            }}
          >
            Your keys.
            <br />
            Your assets.
            <br />
            Simple.
          </div>

          <p
            style={{
              margin: "14px 0 0",
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.45,
              maxWidth: 290,
            }}
          >
            Create a new wallet, import an existing one, or track any EVM
            address in watch-only mode.
          </p>
        </section>

        <section
          style={{
            display: "grid",
            alignContent: "end",
            gap: 10,
          }}
        >
          <button
            type="button"
            className="btn primary lg full"
            onClick={onCreateWallet}
          >
            Create new wallet
            <ArrowIcon />
          </button>

          <div className="row-list">
            <button
              type="button"
              className="row"
              onClick={onImportWallet}
              style={{
                border: 0,
                background: "transparent",
                textAlign: "left",
              }}
            >
              <div className="tok">
                <ImportIcon />
              </div>

              <div className="body">
                <div className="nm">Import wallet</div>
                <div className="sub">Use your seed phrase.</div>
              </div>

              <div className="num">
                <div className="q">›</div>
              </div>
            </button>

            <button
              type="button"
              className="row"
              onClick={onAddWatchWallet}
              style={{
                border: 0,
                background: "transparent",
                textAlign: "left",
              }}
            >
              <div className="tok">
                <WatchIcon />
              </div>

              <div className="body">
                <div className="nm">Watch address</div>
                <div className="sub">Track balances without keys.</div>
              </div>

              <div className="num">
                <div className="q">›</div>
              </div>
            </button>
          </div>
        </section>

        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--bg-surface)",
            padding: 12,
            display: "grid",
            gridTemplateColumns: "32px 1fr",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div
            className="tok"
            style={{
              width: 32,
              height: 32,
              minWidth: 32,
              maxWidth: 32,
              background: "var(--secure-soft)",
              color: "var(--secure)",
            }}
          >
            <ShieldIcon />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 750,
                color: "var(--ink-1)",
              }}
            >
              Local-first by design
            </div>

            <div
              style={{
                marginTop: 4,
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              SIMPLE encrypts your seed phrase on this device only.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default WelcomePage;
