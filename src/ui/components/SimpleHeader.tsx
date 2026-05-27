import type { ReactNode } from "react";

type SimpleHeaderProps = {
  right?: ReactNode;
};

export function SimpleHeader({ right }: SimpleHeaderProps) {
  return (
    <header className="simple-header">
      <div className="simple-logo" aria-label="SIMPLE Wallet">
        <span className="simple-logo__mark" aria-hidden="true" />
        <span className="simple-logo__text">SIMPLE</span>
      </div>

      {right}
    </header>
  );
}