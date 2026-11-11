import type { ButtonHTMLAttributes } from "react";
import { buttonClass } from "./Button";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon";

/** A square, compact button. The label is required because there is no visible text. */
export function IconButton({
  icon,
  label,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={[buttonClass("ghost", "sm"), styles.iconOnly, className].filter(Boolean).join(" ")}
    >
      <Icon name={icon} />
    </button>
  );
}
