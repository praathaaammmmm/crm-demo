import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Pill.module.css";

/** Pills are used only for filters and statuses. */
export function Pill({ children, selected = false }: { children: ReactNode; selected?: boolean }) {
  return <span className={[styles.pill, selected ? styles.selected : undefined].filter(Boolean).join(" ")}>{children}</span>;
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
