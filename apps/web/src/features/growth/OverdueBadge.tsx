import styles from "./Growth.module.css";

/** The API computes `overdue` in the organisation's time zone; this only displays it. */
export function OverdueBadge({ overdue }: { overdue: boolean }) {
  if (!overdue) return null;
  return <span className={[styles.badge, styles.dnc].join(" ")}>Follow-up overdue</span>;
}
