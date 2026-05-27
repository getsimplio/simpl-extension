import type { ButtonHTMLAttributes, ReactNode } from "react";

type SimpleButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type SimpleButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: SimpleButtonVariant;
  children: ReactNode;
};

export function SimpleButton({
  variant = "primary",
  children,
  className = "",
  ...props
}: SimpleButtonProps) {
  return (
    <button
      className={`simple-button simple-button--${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
