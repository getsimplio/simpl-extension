import type { ButtonHTMLAttributes, ReactNode } from "react";

type SimpleIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
};

export function SimpleIconButton({
  children,
  label,
  className = "",
  ...props
}: SimpleIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`simple-icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
