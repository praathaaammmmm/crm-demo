import styles from "./Growth.module.css";

/** Shown when the owner is no longer an active CGO, until the CEO reassigns the record. */
export function OwnerFlag({ flagged }: { flagged: boolean }) {
  if (!flagged) return null;
  return <span className={[styles.badge, styles.flag].join(" ")}>Owner is no longer an active CGO</span>;
}

export function ArchivedBadge() {
  return <span className={[styles.badge, styles.archived].join(" ")}>Archived</span>;
}

export function DoNotContactBadge() {
  return <span className={[styles.badge, styles.dnc].join(" ")}>Do not contact</span>;
}
