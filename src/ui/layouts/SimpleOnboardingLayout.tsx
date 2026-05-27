import type { ReactNode } from "react";
import { SimpleBackButton } from "../components/SimpleBackButton";
import { SimpleHeader } from "../components/SimpleHeader";
import { SimplePage } from "../components/SimplePage";

type SimpleOnboardingLayoutProps = {
  currentStep?: number;
  totalSteps?: number;
  onBack?: () => void;
  children: ReactNode;
};

export function SimpleOnboardingLayout({
  onBack,
  children,
}: SimpleOnboardingLayoutProps) {
  return (
    <SimplePage>
      <SimpleHeader />

      {onBack ? (
        <div className="simple-onboarding-topbar">
          <SimpleBackButton onClick={onBack} />
        </div>
      ) : null}

      {children}
    </SimplePage>
  );
}