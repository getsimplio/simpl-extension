// src/popup/components/Notice.tsx
//
// Shared inline notice used across wallet pages (Send / Add token / …). Matches
// the calm Simpl visual system: a soft-tinted rounded block with a small status
// icon, a bold title, and a muted body. Tone drives the colour tokens only.

import type { ReactNode } from "react";

type NoticeTone = "warning" | "danger" | "success";

type NoticeProps = {
  tone: NoticeTone;
  title: string;
  children: ReactNode;
};

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
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
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

const TONE_STYLES: Record<NoticeTone, { background: string; color: string }> = {
  success: { background: "var(--secure-soft)", color: "var(--secure)" },
  danger: { background: "var(--danger-soft)", color: "var(--danger)" },
  warning: { background: "var(--warn-soft)", color: "var(--warn)" },
};

export function Notice({ tone, title, children }: NoticeProps) {
  return (
    <section
      style={{
        ...TONE_STYLES[tone],
        borderRadius: 12,
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
          background: "rgba(255,255,255,0.48)",
          color: "currentColor",
        }}
      >
        {tone === "success" ? <CheckIcon /> : <AlertIcon />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 750, color: "currentColor" }}>
          {title}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            lineHeight: 1.45,
            color: "currentColor",
            opacity: 0.82,
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

export default Notice;
