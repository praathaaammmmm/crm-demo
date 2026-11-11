import { Icon } from "./Icon";
import styles from "./Notice.module.css";

/** Shown whenever a list reached the 250-item read limit, so a partial view is never mistaken for a full one. */
export function CapNotice({ show, message }: { show: boolean; message: string }) {
  if (!show) return null;
  return (
    <p className={styles.cap} role="status">
      <Icon name="info" />
      {message}
    </p>
  );
}
