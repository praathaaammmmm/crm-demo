import styles from "./Notice.module.css";

/** Shows a safe, user-facing message. Never pass raw response bodies here. */
export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className={styles.error} role="alert">
      {message}
    </div>
  );
}
