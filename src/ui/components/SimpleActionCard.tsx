import type { ButtonHTMLAttributes, ReactNode } from "react";

type SimpleActionCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  title: string;
  description: string;
};

export function SimpleActionCard({
  icon,
  title,
  description,
  className = "",
  ...props
}: SimpleActionCardProps) {
  return (
    <button className={`simple-action-card ${className}`} {...props}>
      <span className="simple-action-card__icon">{icon}</span>

      <span className="simple-action-card__body">
        <span className="simple-action-card__title">{title}</span>
        <span className="simple-action-card__description">{description}</span>
      </span>

      <span className="simple-action-card__arrow">→</span>
    </button>
  );
}
