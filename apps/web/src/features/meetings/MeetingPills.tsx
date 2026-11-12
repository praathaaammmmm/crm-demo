import type { MeetingResponse, MeetingState } from "@crm/contracts/meetings";
import { responseLabel } from "../../lib/meeting-actions";
import styles from "./Meetings.module.css";

function Pill({ tone, label }: { tone: string | undefined; label: string }) {
  return (
    <span className={[styles.pill, tone].filter(Boolean).join(" ")}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Scheduled, Ended (scheduled and over) or Cancelled. */
export function MeetingStatusPill({ status, endsAt }: { status: MeetingState; endsAt: string }) {
  if (status === "cancelled") return <Pill tone={styles.danger} label="Cancelled" />;
  return Date.parse(endsAt) <= Date.now() ? <Pill tone={styles.neutral} label="Ended" /> : <Pill tone={styles.info} label="Scheduled" />;
}

const RESPONSE_TONE: Record<MeetingResponse, string | undefined> = {
  pending: styles.warning,
  accepted: styles.success,
  declined: styles.neutral,
};

export const ResponsePill = ({ response }: { response: MeetingResponse }) => (
  <Pill tone={RESPONSE_TONE[response]} label={responseLabel(response)} />
);
