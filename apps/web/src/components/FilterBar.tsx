import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Toolbar.module.css";

/** A wrapping row of compact filter controls with a Clear link when any filter is active. */
export function FilterBar({ children, clearHref }: { children: ReactNode; clearHref: string | null }) {
  return (
    <div className={styles.filters} role="group" aria-label="Filters">
      {children}
      {clearHref === null ? null : (
        <Link href={clearHref} className={styles.clear}>
          Clear
        </Link>
      )}
    </div>
  );
}

export function FilterDivider() {
  return <span className={styles.divider} aria-hidden="true" />;
}
