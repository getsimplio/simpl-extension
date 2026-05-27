import type { ButtonHTMLAttributes } from "react";

type SimpleBackButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function SimpleBackButton({
  className = "",
  ...props
}: SimpleBackButtonProps) {
  return (
    <button
      type="button"
      className={`simple-back-button ${className}`}
      aria-label="Back"
      title="Back"
      {...props}
    >
      <span aria-hidden="true">‹</span>
    </button>
  );
}
