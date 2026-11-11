import styles from "./Notice.module.css";

/** Loading placeholder lines. The status text is announced once. */
export function Skeleton({ lines = 6, label = "Loading…" }: { lines?: number; label?: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={styles.skeletonLine} style={{ width: `${String(100 - (index % 3) * 18)}%` }} />
      ))}
    </div>
  );
}
