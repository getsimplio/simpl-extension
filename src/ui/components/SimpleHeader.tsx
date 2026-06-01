import type { ReactNode } from "react";
import logoUrl from "../../assets/simpl-logo.png";

type SimpleHeaderProps = {
  right?: ReactNode;
};

export function SimpleHeader({ right }: SimpleHeaderProps) {
  return (
    <header className="simple-header">
      <img
        src={logoUrl}
        alt="Simpl wallet"
        style={{ height: 30, width: "auto", objectFit: "contain" }}
      />

      {right}
    </header>
  );
}