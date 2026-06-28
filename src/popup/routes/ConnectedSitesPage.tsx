import { useEffect, useMemo, useState } from "react";

import { t, useTranslation } from "../../i18n";
import WalletConnectPage from "./WalletConnectPage";
type ConnectedSiteType = "evm" | "tron" | "walletconnect";

type ConnectedSite = {
  id: string;
  origin: string;
  name?: string;
  iconUrl?: string;
  type?: ConnectedSiteType;
  connectedAt?: string;
  lastUsedAt?: string;
};

function siteTypeBadge(type: ConnectedSiteType | undefined): {
  label: string;
  bg: string;
  fg: string;
} {
  if (type === "tron") {
    return { label: "TRON", bg: "var(--danger-soft)", fg: "var(--danger)" };
  }
  if (type === "walletconnect") {
    return { label: "WalletConnect", bg: "var(--info-soft)", fg: "var(--info)" };
  }
  return { label: "EVM", bg: "var(--line)", fg: "var(--ink-2)" };
}

type ConnectedSitesPageProps = {
  onBack: () => void;
};

const CONNECTED_SITES_KEY = "connectedSites";

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function GlobeIcon() {
return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.7 3.7 5.7 3.7 9S14.5 18.3 12 21" />
      <path d="M12 3c-2.5 2.7-3.7 5.7-3.7 9S9.5 18.3 12 21" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 15h10l1-15" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function getChromeStorageLocal() {
  return (globalThis as unknown as {
    chrome?: {
      storage?: {
        local?: {
          get?: (
            keys: string[] | string | null,
            callback: (items: Record<string, unknown>) => void,
          ) => void;
          set?: (items: Record<string, unknown>, callback?: () => void) => void;
        };
      };
    };
  }).chrome?.storage?.local;
}

function chromeStorageGet(keys: string[] | string | null): Promise<Record<string, unknown>> {
  const storage = getChromeStorageLocal();
  const get = storage?.get;

  if (!storage || typeof get !== "function") {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    try {
      get.call(storage, keys, (items: Record<string, unknown>) => {
        resolve(items ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  const storage = getChromeStorageLocal();
  const set = storage?.set;

  if (!storage || typeof set !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      set.call(storage, items, () => resolve());
    } catch {
      resolve();
    }
  });
}

function safeParseConnectedSites(value: unknown): ConnectedSite[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sites: ConnectedSite[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const origin = typeof record.origin === "string" ? record.origin.trim() : "";

    if (!origin) {
      continue;
    }

    const site: ConnectedSite = {
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id
          : origin,
      origin,
    };

    if (typeof record.name === "string" && record.name.trim()) {
      site.name = record.name;
    }

    if (typeof record.iconUrl === "string" && record.iconUrl.trim()) {
      site.iconUrl = record.iconUrl;
    }

    if (
      record.type === "evm" ||
      record.type === "tron" ||
      record.type === "walletconnect"
    ) {
      site.type = record.type;
    }

    if (typeof record.connectedAt === "string" && record.connectedAt.trim()) {
      site.connectedAt = record.connectedAt;
    }

    if (typeof record.lastUsedAt === "string" && record.lastUsedAt.trim()) {
      site.lastUsedAt = record.lastUsedAt;
    }

    sites.push(site);
  }

  return sites;
}

async function readConnectedSites(): Promise<ConnectedSite[]> {
  const stored = await chromeStorageGet(CONNECTED_SITES_KEY);
  const fromChrome = safeParseConnectedSites(stored[CONNECTED_SITES_KEY]);

  if (fromChrome.length > 0) {
    return fromChrome;
  }

  try {
    const raw = localStorage.getItem(CONNECTED_SITES_KEY);
    return safeParseConnectedSites(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

async function writeConnectedSites(sites: ConnectedSite[]) {
  await chromeStorageSet({
    [CONNECTED_SITES_KEY]: sites,
  });

  try {
    localStorage.setItem(CONNECTED_SITES_KEY, JSON.stringify(sites));
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }
}

function formatDate(value?: string): string {
  if (!value) {
    return t("common.never");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return t("common.unknown");
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getSiteLabel(site: ConnectedSite): string {
  if (site.name) {
    return site.name;
  }

  try {
    return new URL(site.origin).hostname;
  } catch {
    return site.origin;
  }
}

export default function ConnectedSitesPage({ onBack }: ConnectedSitesPageProps) {
  const { t } = useTranslation();
  const [sites, setSites] = useState<ConnectedSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDisconnectAll, setConfirmDisconnectAll] = useState(false);
  const [showWalletConnect, setShowWalletConnect] = useState(false);

  const sortedSites = useMemo(() => {
    return [...sites].sort((left, right) => {
      const leftTime = left.lastUsedAt ?? left.connectedAt ?? "";
      const rightTime = right.lastUsedAt ?? right.connectedAt ?? "";

      return rightTime.localeCompare(leftTime);
    });
  }, [sites]);

  async function refresh() {
    setIsLoading(true);

    try {
      const nextSites = await readConnectedSites();
      setSites(nextSites);
    } finally {
      setIsLoading(false);
    }
  }

  async function disconnectSite(siteId: string) {
    const nextSites = sites.filter((site) => site.id !== siteId);

    setSites(nextSites);
    await writeConnectedSites(nextSites);
  }

  async function disconnectAll() {
    setConfirmDisconnectAll(false);
    setSites([]);
    await writeConnectedSites([]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (showWalletConnect) {
    return (
      <WalletConnectPage
        onBack={() => {
          setShowWalletConnect(false);
          void refresh();
        }}
        onConnected={async () => {
          await refresh();
        }}
      />
    );
  }

  return (
    <main
      style={{
        height: "100vh",
        minHeight: "100vh",
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--bg, var(--bg-surface))",
        color: "var(--text-primary, var(--ink-1))",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          height: 56,
          borderBottom: "1px solid var(--border, var(--bg-muted))",
          background: "var(--bg, var(--bg-surface))",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 680,
            height: "100%",
            margin: "0 auto",
            padding: "0 12px",
            boxSizing: "border-box",
            display: "grid",
            gridTemplateColumns: "44px 1fr 44px",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            style={{
              width: 36,
              height: 36,
              border: 0,
              background: "transparent",
              color: "var(--text-primary, var(--ink-1))",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <BackIcon />
          </button>

          <div
            style={{
              fontSize: 15,
              lineHeight: "20px",
              fontWeight: 800,
            }}
          >
            {t("connectedSites.title")}
          </div>

          <div />
        </div>
      </header>

      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
          padding: "52px 12px 88px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            margin: 0,
            maxWidth: 520,
            fontSize: 46,
            lineHeight: "50px",
            letterSpacing: "-0.055em",
            fontWeight: 900,
          }}
        >
          {t("connectedSites.heroTitle")}
        </h1>

        <p
          style={{
            margin: "14px 0 0",
            maxWidth: 560,
            color: "var(--text-secondary, var(--ink-3))",
            fontSize: 14,
            lineHeight: "21px",
          }}
        >
          {t("connectedSites.heroSub")}
        </p>

        <button
          type="button"
          className="btn primary lg full"
          onClick={() => setShowWalletConnect(true)}
          style={{ marginTop: 28 }}
        >
          {t("connectedSites.connectWithWc")}
        </button>

        <section style={{ marginTop: 36 }}>
          <div
            style={{
              marginBottom: 14,
              color: "var(--text-primary, var(--ink-1))",
              fontSize: 12,
              lineHeight: "16px",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 800,
            }}
          >
            {t("connectedSites.sites")}
          </div>

          {isLoading ? (
            <div
              style={{
                color: "var(--text-secondary, var(--ink-3))",
                fontSize: 14,
                lineHeight: "20px",
              }}
            >
              {t("connectedSites.loading")}
            </div>
          ) : sortedSites.length === 0 ? (
            <div
              style={{
                border: "1px solid var(--border, var(--line))",
                borderRadius: 24,
                padding: 22,
                background: "var(--bg, var(--bg-surface))",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  background: "var(--text-primary, var(--ink-1))",
                  color: "var(--bg-surface)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <GlobeIcon />
              </div>

              <div
                style={{
                  marginTop: 16,
                  fontSize: 18,
                  lineHeight: "24px",
                  fontWeight: 850,
                  letterSpacing: "-0.02em",
                }}
              >
                {t("connectedSites.emptyTitle")}
              </div>

              <p
                style={{
                  margin: "6px 0 0",
                  color: "var(--text-secondary, var(--ink-3))",
                  fontSize: 13,
                  lineHeight: "19px",
                }}
              >
                {t("connectedSites.emptyBody")}
              </p>
            </div>
          ) : (
            <div className="row-list">
              {sortedSites.map((site) => (
                <div
                  key={site.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 1fr auto",
                    gap: 16,
                    alignItems: "center",
                    minHeight: 64,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      background: "var(--text-primary, var(--ink-1))",
                      color: "var(--bg-surface)",
                      display: "grid",
                      placeItems: "center",
                      overflow: "hidden",
                    }}
                  >
                    {site.iconUrl ? (
                      <img
                        src={site.iconUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <GlobeIcon />
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          lineHeight: "18px",
                          fontWeight: 850,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {getSiteLabel(site)}
                      </span>

                      {(() => {
                        const badge = siteTypeBadge(site.type);
                        return (
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 10,
                              lineHeight: "14px",
                              fontWeight: 800,
                              letterSpacing: "0.04em",
                              padding: "2px 7px",
                              borderRadius: 999,
                              background: badge.bg,
                              color: badge.fg,
                            }}
                          >
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>

                    <div
                      style={{
                        marginTop: 2,
                        color: "var(--text-secondary, var(--ink-3))",
                        fontSize: 12,
                        lineHeight: "16px",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {site.origin}
                    </div>

                    <div
                      style={{
                        marginTop: 2,
                        color: "var(--text-secondary, var(--ink-3))",
                        fontSize: 12,
                        lineHeight: "16px",
                      }}
                    >
                      {t("connectedSites.lastUsed", {
                        date: formatDate(site.lastUsedAt),
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={t("connectedSites.disconnectSite", {
                      site: getSiteLabel(site),
                    })}
                    onClick={() => void disconnectSite(site.id)}
                    style={{
                      border: "1px solid var(--danger-soft)",
                      borderRadius: 999,
                      background: "var(--danger-soft)",
                      color: "var(--danger)",
                      cursor: "pointer",
                      width: 36,
                      height: 36,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {sortedSites.length > 0 ? (
          <button
            type="button"
            className="btn secondary lg full"
            onClick={() => setConfirmDisconnectAll(true)}
            style={{ marginTop: 18 }}
          >
            {t("connectedSites.disconnectAll")}
          </button>
        ) : null}

        <p
          style={{
            margin: "24px 0 0",
            padding: 16,
            borderRadius: 16,
            background: "var(--bg-muted)",
            color: "var(--text-secondary, var(--ink-3))",
            fontSize: 13,
            lineHeight: "19px",
          }}
        >
          {t("connectedSites.notice")}
        </p>
      </section>

      {confirmDisconnectAll ? (
        <div
          role="presentation"
          onClick={() => setConfirmDisconnectAll(false)}
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
            aria-label={t("connectedSites.confirmAllLabel")}
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
                border: "1px solid var(--border, var(--line))",
                borderRadius: 24,
                background: "var(--bg, var(--bg-surface))",
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
                {t("connectedSites.confirmAllTitle")}
              </div>

              <p
                style={{
                  margin: "8px 0 0",
                  color: "var(--text-secondary, var(--ink-3))",
                  fontSize: 13,
                  lineHeight: "19px",
                }}
              >
                {t("connectedSites.confirmAllBody")}
              </p>

              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  className="btn primary lg full"
                  onClick={() => void disconnectAll()}
                  style={{
                    background: "var(--danger)",
                    borderColor: "var(--danger)",
                  }}
                >
                  {t("connectedSites.disconnectAll")}
                </button>

                <button
                  type="button"
                  className="btn secondary lg full"
                  onClick={() => setConfirmDisconnectAll(false)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
