import type { Meeting } from "@crm/contracts/meetings";
import { dayLabel, groupAgenda } from "../../lib/meeting-view";
import { MeetingCard } from "./MeetingCard";
import styles from "./Meetings.module.css";

/** Agenda: meetings grouped by local day, in API order. */
export function MeetingAgenda({ meetings, timeZone }: { meetings: Meeting[]; timeZone: string }) {
  return (
    <div className={styles.agenda}>
      {groupAgenda(meetings, timeZone).map((group) => (
        <section key={group.day} aria-labelledby={`day-${group.day}`}>
          <h2 id={`day-${group.day}`} className={styles.dayHeading}>
            {dayLabel(group.day)}
          </h2>
          <ul className={styles.list}>
            {group.meetings.map((meeting) => (
              <li key={meeting.id}>
                <MeetingCard meeting={meeting} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
