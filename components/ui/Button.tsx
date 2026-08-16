import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

// min-h-11 is 44px. Every tap target in this app clears 44×44 — it is mobile-first, and the
// PIN keypad in auth-c is built on this primitive.
const BASE_CLASSES =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 " +
  "text-sm font-medium transition-colors focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-foreground hover:bg-surface-raised",
  danger: "bg-danger text-primary-foreground hover:opacity-90",
};

export function Button({
  variant = "primary",
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      {...props}
    />
  );
}
