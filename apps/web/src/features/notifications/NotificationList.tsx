import { reminderState, type Notification } from "@crm/contracts/notifications";
import Link from "next/link";
import { localTime } from "../../lib/meeting-view";
import { formatTimestamp } from "../tasks/TimelineEntry";
import { MarkReadButton } from "./NotificationActions";
import styles from "./Notifications.module.css";

/** Text is built from the current meeting; reminders for older versions say the meeting changed. */
function describe(notification: Notification, timeZone: string): string {
  const state = reminderState(notification);
  if (state === "unavailable" || notification.meeting === null) return "Reminder for a meeting you are no longer invited to";
  const { title, startsAt } = notification.meeting;
  if (state === "cancelled") return `${title} was cancelled`;
  if (state === "rescheduled") return `${title} was rescheduled to ${localTime(startsAt, timeZone)}`;
  return `${title} starts in ${String(notification.minutesBefore)} minutes (${localTime(startsAt, timeZone)})`;
}

export function NotificationList({ notifications, timeZone }: { notifications: Notification[]; timeZone: string }) {
  return (
    <ul className={styles.list} aria-label="Notifications">
      {notifications.map((notification) => {
        const text = describe(notification, timeZone);
        return (
          <li key={notification.id} className={[styles.item, notification.readAt === null ? styles.unread : undefined].filter(Boolean).join(" ")}>
            <span className={styles.main}>
              {notification.meeting ? (
                <Link href={`/meetings/${notification.meetingId}`} className={styles.text}>
                  {text}
                </Link>
              ) : (
                <span className={styles.text}>{text}</span>
              )}
              <span className={styles.meta}>{formatTimestamp(notification.createdAt)}</span>
            </span>
            {notification.readAt === null ? <MarkReadButton notificationId={notification.id} label={text} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
