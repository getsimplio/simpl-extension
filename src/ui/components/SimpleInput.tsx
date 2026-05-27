import type { InputHTMLAttributes } from "react";

type SimpleInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function SimpleInput({
  label,
  id,
  className = "",
  ...props
}: SimpleInputProps) {
  const inputId = id ?? props.name;

  return (
    <label className="simple-field">
      {label ? <span className="simple-label">{label}</span> : null}

      <input
        id={inputId}
        className={`simple-input ${className}`}
        {...props}
      />
    </label>
  );
}