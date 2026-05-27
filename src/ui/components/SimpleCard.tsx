import type { HTMLAttributes, ReactNode } from "react";

type SimpleCardProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
  children: ReactNode;
};

export function SimpleCard({
  padded = true,
  children,
  className = "",
  ...props
}: SimpleCardProps) {
  return (
    <div
      className={`simple-card ${padded ? "simple-card--padded" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
