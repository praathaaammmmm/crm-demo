import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Pill.module.css";

export type PillTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_CLASS: Record<PillTone, string | undefined> = {
  neutral: undefined,
  accent: styles.toneAccent,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
};

/** Pills are used only for filters, roles and statuses. `tone` and `dot` are optional and default to the plain pill. */
export function Pill({
  children,
  selected = false,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  selected?: boolean;
  tone?: PillTone;
  dot?: boolean;
}) {
  return (
    <span className={[styles.pill, TONE_CLASS[tone], selected ? styles.selected : undefined].filter(Boolean).join(" ")}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A filter pill that navigates (works without JavaScript). */
export function PillLink({ href, selected, children }: { href: string; selected: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={[styles.pill, selected ? styles.selected : undefined].filter(Boolean).join(" ")}
      aria-current={selected ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
