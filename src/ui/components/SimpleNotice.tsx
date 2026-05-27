import type { ReactNode } from "react";

type SimpleNoticeVariant = "default" | "warning" | "danger";

type SimpleNoticeProps = {
  title: string;
  children: ReactNode;
  variant?: SimpleNoticeVariant;
};

export function SimpleNotice({
  title,
  children,
  variant = "default",
}: SimpleNoticeProps) {
  const variantClass =
    variant === "default" ? "" : `simple-notice--${variant}`;

  return (
    <section className={`simple-notice ${variantClass}`}>
      <h2 className="simple-notice__title">{title}</h2>
      <div className="simple-notice__text">{children}</div>
    </section>
  );
}
