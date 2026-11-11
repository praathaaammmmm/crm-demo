import type { ReactNode } from "react";
import { Avatar } from "../../components/Avatar";
import styles from "./Timeline.module.css";

/** Always shown in UTC so every viewer reads the same time. */
export const formatTimestamp = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function TimelineEntry({
  actor,
  action,
  at,
  children,
}: {
  actor: string;
  action: string;
  at: string;
  children?: ReactNode;
}) {
  return (
    <li className={styles.entry}>
      <Avatar name={actor} />
      <div>
        <div className={styles.line}>
          <span className={styles.actor}>{actor}</span>
          <span className={styles.action}>{action}</span>
          <time className={styles.time} dateTime={at}>
            {formatTimestamp(at)}
          </time>
        </div>
        {children ? <div className={styles.content}>{children}</div> : null}
      </div>
    </li>
  );
}
