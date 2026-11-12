import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./Toolbar.module.css";

/**
 * The 48px page toolbar: icon and breadcrumb/title on the left; controls, then one primary action,
 * on the right. Renders the page's h1.
 */
export function PageToolbar({
  icon,
  title,
  breadcrumbs = [],
  count,
  countLabel,
  controls,
  primaryAction,
}: {
  icon: IconName;
  title: string;
  breadcrumbs?: { href: string; label: string }[];
  /** Optional record count shown after the title. */
  count?: number | undefined;
  /** Accessible text for the count, e.g. "12 users". */
  countLabel?: string | undefined;
  controls?: ReactNode;
  primaryAction?: ReactNode;
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.heading}>
        <Icon name={icon} />
        {breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            {breadcrumbs.map((crumb) => (
              <span key={crumb.href} className={styles.crumbs}>
                <Link href={crumb.href}>{crumb.label}</Link>
                <Icon name="chevron" />
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        {count === undefined ? null : (
          <span className={styles.count}>
            <span aria-hidden={countLabel === undefined ? undefined : true}>{count}</span>
            {countLabel === undefined ? null : <span className="visually-hidden">{countLabel}</span>}
          </span>
        )}
      </div>
      {controls || primaryAction ? (
        <div className={styles.right}>
          {controls}
          {primaryAction}
        </div>
      ) : null}
    </div>
  );
}

/** Padded page body under the toolbar. */
export function PageContent({ children }: { children: ReactNode }) {
  return <div className={styles.content}>{children}</div>;
}
