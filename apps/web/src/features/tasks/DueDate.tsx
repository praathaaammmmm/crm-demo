import { Icon } from "../../components/Icon";
import styles from "./Tasks.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a YYYY-MM-DD date without time-zone conversion. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1];
  return name === undefined || day === undefined || year === undefined ? date : `${name} ${String(Number(day))}, ${year}`;
}

/** Overdue dates use danger colour, an icon, and the word "Overdue" so colour is not the only signal. */
export function DueDate({ date, overdue }: { date: string; overdue: boolean }) {
  return (
    <span className={[styles.due, overdue ? styles.overdue : undefined].filter(Boolean).join(" ")}>
      <Icon name={overdue ? "alert" : "calendar"} />
      <time dateTime={date}>{formatDate(date)}</time>
      {overdue ? <span>· Overdue</span> : null}
    </span>
  );
}
