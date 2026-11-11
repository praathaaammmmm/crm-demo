import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Disables the button and shows busyLabel while a request is in flight. */
  busy?: boolean;
  busyLabel?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  secondary: undefined,
  ghost: styles.ghost,
  danger: styles.danger,
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md"): string {
  return [styles.button, VARIANT_CLASS[variant], size === "sm" ? styles.sm : undefined].filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  busyLabel = "Saving…",
  disabled,
  children,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={[buttonClass(variant, size), className].filter(Boolean).join(" ")}
      disabled={disabled === true || busy}
      aria-busy={busy}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
