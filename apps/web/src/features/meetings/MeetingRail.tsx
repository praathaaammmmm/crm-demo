import type { Meeting } from "@crm/contracts/meetings";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import type { MeetingActions } from "../../lib/meeting-actions";
import { timeRangeLabel } from "../../lib/meeting-view";
import { isSafeProofUrl } from "../../lib/task-actions";
import rail from "../tasks/Rail.module.css";
import { formatTimestamp } from "../tasks/TimelineEntry";
import { CancelMeetingDialog } from "./CancelMeetingDialog";
import { MeetingStatusPill, ResponsePill } from "./MeetingPills";
import styles from "./Meetings.module.css";
import { ResponseActions } from "./ResponseActions";

/** Time, place, reference and the actions this viewer may take. The reset notice relies only on responsesResetAt. */
export function MeetingRail({
  meeting,
  actions,
  timeZone,
  organizerName,
  reference,
  editAction,
}: {
  meeting: Meeting;
  actions: MeetingActions;
  timeZone: string;
  organizerName: string;
  reference: ReactNode;
  editAction: ReactNode;
}) {
  return (
    <aside className={rail.rail} aria-label="Meeting details">
      <div className={rail.panel}>
        <dl className={rail.meta}>
          <dt>Status</dt>
          <dd>
            <MeetingStatusPill status={meeting.status} endsAt={meeting.endsAt} />
          </dd>
          <dt>When</dt>
          <dd>{timeRangeLabel(meeting.startsAt, meeting.endsAt, timeZone)}</dd>
          {meeting.location ? (
            <>
              <dt>Location</dt>
              <dd>{meeting.location}</dd>
            </>
          ) : null}
          {meeting.meetingUrl ? (
            <>
              <dt>Link</dt>
              <dd>
                {isSafeProofUrl(meeting.meetingUrl) ? (
                  <a href={meeting.meetingUrl} target="_blank" rel="noopener noreferrer nofollow">
                    <Icon name="link" /> Join link
                  </a>
                ) : (
                  meeting.meetingUrl
                )}
              </dd>
            </>
          ) : null}
          {reference ? (
            <>
              <dt>Linked to</dt>
              <dd>{reference}</dd>
            </>
          ) : null}
          <dt>Organiser</dt>
          <dd>{organizerName}</dd>
          {actions.currentResponse ? (
            <>
              <dt>Your response</dt>
              <dd>
                <ResponsePill response={actions.currentResponse} />
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      {actions.showResetNotice && meeting.responsesResetAt ? (
        <p className={styles.notice} role="status">
          <Icon name="info" />
          Responses were reset after rescheduling on {formatTimestamp(meeting.responsesResetAt)}.
        </p>
      ) : null}

      {actions.readOnly ? (
        <p className={rail.muted} role="status">
          {meeting.status === "cancelled" ? "This meeting was cancelled and is read-only." : "This meeting has ended."}
        </p>
      ) : (
        <div className={[rail.panel, rail.actions].join(" ")}>
          {actions.canRespond && actions.currentResponse ? <ResponseActions meetingId={meeting.id} current={actions.currentResponse} /> : null}
          {actions.canEdit || actions.canCancel ? (
            <div className={styles.actionRow}>
              {actions.canEdit ? editAction : null}
              {actions.canCancel ? <CancelMeetingDialog meetingId={meeting.id} /> : null}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
