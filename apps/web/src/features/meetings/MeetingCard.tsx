import type { Meeting } from "@crm/contracts/meetings";
import Link from "next/link";
import { timeRangeLabel } from "../../lib/meeting-view";
import { MeetingStatusPill, ResponsePill } from "./MeetingPills";
import styles from "./Meetings.module.css";

/** One meeting as a link: title, time in the organisation's time zone, status and the viewer's response. */
export function MeetingCard({ meeting, timeZone }: { meeting: Meeting; timeZone: string }) {
  return (
    <Link href={`/meetings/${meeting.id}`} className={[styles.card, meeting.status === "cancelled" ? styles.cardCancelled : undefined].filter(Boolean).join(" ")}>
      <span className={styles.cardTop}>
        <span className={styles.cardTitle}>{meeting.title}</span>
        <MeetingStatusPill status={meeting.status} endsAt={meeting.endsAt} />
      </span>
      <span className={styles.cardMeta}>{timeRangeLabel(meeting.startsAt, meeting.endsAt, timeZone)}</span>
      {meeting.location ? <span className={styles.cardMeta}>{meeting.location}</span> : null}
      {meeting.viewerResponse && meeting.status === "scheduled" ? (
        <span>
          <ResponsePill response={meeting.viewerResponse} />
        </span>
      ) : null}
    </Link>
  );
}
