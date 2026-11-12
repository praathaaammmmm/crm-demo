import { sql } from "drizzle-orm";
import { z } from "zod";
import { HandlerError, type Handler } from "../../platform/worker/handlers.js";

const payloadSchema = z.strictObject({
  meetingId: z.uuid(),
  version: z.int().min(1),
  minutesBefore: z.union([z.literal(10), z.literal(5), z.literal(2)]),
});

/**
 * meetings.reminder_due, run by the worker as crm_worker. Takes the meeting's advisory lock shared, so a
 * concurrent edit (which takes it exclusively) is either finished and seen, or waits. Stale reminders
 * (cancelled, rescheduled, missing, or already started meetings) end as `cancelled`. Otherwise one
 * notification per current, active attendee who has not declined; the unique (source event, recipient)
 * key makes re-runs harmless.
 */
export const meetingReminderHandler: Handler = async (tx, event) => {
  const parsed = payloadSchema.safeParse(event.payload);
  if (!parsed.success) throw new HandlerError("invalid_payload");
  const { meetingId, version, minutesBefore } = parsed.data;

  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`meeting:${meetingId}`}, 0))`);
  const result = await tx.execute<{ status: string; version: number; started: boolean }>(sql`
    SELECT status, version, starts_at <= now() AS started FROM meetings WHERE id = ${meetingId}
  `);
  const meeting = result.rows[0];
  if (!meeting || meeting.status !== "scheduled" || meeting.version !== version || meeting.started) return "cancelled";

  await tx.execute(sql`
    INSERT INTO notifications (recipient_id, kind, meeting_id, meeting_version, minutes_before, source_event_id)
    SELECT a.user_id, 'meeting_reminder', ${meetingId}, ${version}, ${minutesBefore}, ${event.id}
    FROM meeting_attendees a JOIN users u ON u.id = a.user_id
    WHERE a.meeting_id = ${meetingId} AND a.removed_at IS NULL AND a.response <> 'declined' AND u.status = 'active'
    ON CONFLICT (source_event_id, recipient_id) DO NOTHING
  `);
  return "done";
};
