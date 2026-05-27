import type { ReactNode } from "react";
import { SimpleHeader } from "../components/SimpleHeader";
import { SimplePage } from "../components/SimplePage";

type SimpleWalletLayoutProps = {
  children: ReactNode;
  right?: ReactNode;
};

export function SimpleWalletLayout({
  children,
  right,
}: SimpleWalletLayoutProps) {
  return (
    <SimplePage>
      <SimpleHeader right={right} />

      <div className="simple-wallet-layout">{children}</div>
    </SimplePage>
  );
}
