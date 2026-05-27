import type { ReactNode } from "react";

type SimpleTopBarProps = {
  title: string;
  onBack?: () => void;
  rightSlot?: ReactNode;
};

export function SimpleTopBar({
  title,
  onBack,
  rightSlot,
}: SimpleTopBarProps) {
  return (
    <div className="simple-topbar">
      <div className="simple-topbar__left">
        {onBack ? (
          <button
            type="button"
            className="simple-back-button"
            onClick={onBack}
            aria-label="Go back"
          >
            <span>‹</span>
          </button>
        ) : (
          <div className="simple-topbar__back-placeholder" />
        )}

        <div className="simple-topbar__label">{title}</div>
      </div>

      {rightSlot ? <div className="simple-topbar__right">{rightSlot}</div> : null}
    </div>
  );
}