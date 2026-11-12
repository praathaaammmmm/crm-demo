import type { Meeting } from "@crm/contracts/meetings";
import { dayLabel, localDateKey, weekCells } from "../../lib/meeting-view";
import { MeetingCard } from "./MeetingCard";
import styles from "./Meetings.module.css";

/** Week grid, Monday first; each meeting appears on the local day it starts. */
export function MeetingWeek({ meetings, timeZone, start }: { meetings: Meeting[]; timeZone: string; start: string }) {
  const today = localDateKey(Date.now(), timeZone);
  return (
    <div className={styles.week} role="list" aria-label="Week">
      {weekCells(meetings, start, timeZone).map((cell) => (
        <section
          key={cell.day}
          role="listitem"
          aria-label={dayLabel(cell.day)}
          className={[styles.weekDay, cell.day === today ? styles.weekToday : undefined].filter(Boolean).join(" ")}
        >
          <h2 className={styles.dayHeading}>{dayLabel(cell.day)}</h2>
          {cell.meetings.length === 0 ? (
            <span className={styles.weekEmpty}>No meetings</span>
          ) : (
            cell.meetings.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} timeZone={timeZone} />)
          )}
        </section>
      ))}
    </div>
  );
}
