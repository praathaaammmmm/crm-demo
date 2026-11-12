import type { MeetingResponse, MeetingState, ReminderOffset } from "@crm/contracts/meetings";
import { meetingAttendees, meetings, tasks, users } from "@crm/database/schema";
import { and, asc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

/**
 * Serialises changes to one meeting with the reminder worker. The API takes this transaction-level
 * advisory lock exclusively; the worker takes it shared. Advisory locks need no table privileges, so the
 * worker stays read-only on meetings.
 */
export async function lockMeetingKey(tx: Tx, meetingId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`meeting:${meetingId}`}, 0))`);
}

/** Converts a wall-clock "YYYY-MM-DDTHH:MM" in the organisation's time zone to UTC, in the database. */
export async function localToUtc(db: Executor, local: string, timeZone: string): Promise<Date> {
  const result = await db.execute<{ at: string }>(sql`
    SELECT to_char((${local}::timestamp AT TIME ZONE ${timeZone}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
  `);
  const at = result.rows[0]?.at;
  if (at === undefined) throw new Error("Time conversion returned no row");
  return new Date(at);
}

/** Meeting columns plus the viewer's own current response (null when the viewer is not a current attendee). */
const meetingColumns = {
  id: meetings.id,
  title: meetings.title,
  description: meetings.description,
  startsAt: meetings.startsAt,
  endsAt: meetings.endsAt,
  location: meetings.location,
  meetingUrl: meetings.meetingUrl,
  projectId: meetings.projectId,
  taskId: meetings.taskId,
  status: meetings.status,
  version: meetings.version,
  organizerId: meetings.organizerId,
  createdAt: meetings.createdAt,
  updatedAt: meetings.updatedAt,
  cancelledAt: meetings.cancelledAt,
  responsesResetAt: meetings.responsesResetAt,
  viewerResponse: meetingAttendees.response,
};

const viewerJoin = (viewerId: string) =>
  and(eq(meetingAttendees.meetingId, meetings.id), eq(meetingAttendees.userId, viewerId), isNull(meetingAttendees.removedAt));

export type MeetingRow = NonNullable<Awaited<ReturnType<typeof findMeeting>>>;
export interface AttendeeRow {
  userId: string;
  response: MeetingResponse;
  respondedAt: Date | null;
}

export async function findMeeting(db: Executor, id: string, viewerId: string) {
  const rows = await db.select(meetingColumns).from(meetings).leftJoin(meetingAttendees, viewerJoin(viewerId)).where(eq(meetings.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks only the meeting row until the transaction ends. */
export async function lockMeeting(tx: Tx, id: string, viewerId: string) {
  const rows = await tx
    .select(meetingColumns)
    .from(meetings)
    .leftJoin(meetingAttendees, viewerJoin(viewerId))
    .where(eq(meetings.id, id))
    .limit(1)
    .for("update", { of: meetings });
  return rows[0] ?? null;
}

/** Meetings overlapping [from, to), ordered by (starts_at, id) with keyset paging. */
export async function listMeetings(
  db: Executor,
  filter: {
    viewerId: string;
    invitedOnly: boolean;
    from: string;
    to: string;
    status: MeetingState | undefined;
    cursor: string | undefined;
    limit: number;
  },
) {
  const conditions: SQL[] = [lt(meetings.startsAt, new Date(filter.to)), gt(meetings.endsAt, new Date(filter.from))];
  if (filter.invitedOnly) conditions.push(sql`${meetingAttendees.userId} IS NOT NULL`);
  if (filter.status !== undefined) conditions.push(eq(meetings.status, filter.status));
  if (filter.cursor !== undefined) {
    conditions.push(sql`(${meetings.startsAt}, ${meetings.id}) > (SELECT starts_at, id FROM meetings WHERE id = ${filter.cursor})`);
  }
  return db
    .select(meetingColumns)
    .from(meetings)
    .leftJoin(meetingAttendees, viewerJoin(filter.viewerId))
    .where(and(...conditions))
    .orderBy(asc(meetings.startsAt), asc(meetings.id))
    .limit(filter.limit + 1);
}

/** Current attendees (not soft-removed), in the order they were added. */
export function currentAttendees(db: Executor, meetingId: string): Promise<AttendeeRow[]> {
  return db
    .select({ userId: meetingAttendees.userId, response: meetingAttendees.response, respondedAt: meetingAttendees.respondedAt })
    .from(meetingAttendees)
    .where(and(eq(meetingAttendees.meetingId, meetingId), isNull(meetingAttendees.removedAt)))
    .orderBy(asc(meetingAttendees.addedAt), asc(meetingAttendees.userId));
}

/** The subset of ids that are active users other than the CEO/CTO. */
export async function activeNonAdminUserIds(db: Executor, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...ids]), eq(users.status, "active"), eq(users.isSuperAdmin, false)));
  return rows.map((row) => row.id);
}

export async function taskInProject(db: Executor, taskId: string, projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  return rows.length > 0;
}

// Explicit column lists below: crm_app may insert only these columns.

export async function insertMeeting(
  tx: Tx,
  input: {
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
    meetingUrl: string | null;
    projectId: string | null;
    taskId: string | null;
    organizerId: string;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO meetings (title, description, starts_at, ends_at, location, meeting_url, project_id, task_id, organizer_id)
    VALUES (${input.title}, ${input.description}, ${input.startsAt.toISOString()}::timestamptz, ${input.endsAt.toISOString()}::timestamptz,
            ${input.location}, ${input.meetingUrl}, ${input.projectId}, ${input.taskId}, ${input.organizerId})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Meeting insert returned no row");
  return row.id;
}

/**
 * Adds attendees as pending. Someone soft-removed earlier is restored as a fresh pending attendee.
 * Current attendees are never touched here.
 */
export async function addAttendees(tx: Tx, meetingId: string, userIds: readonly string[]): Promise<void> {
  for (const userId of userIds) {
    await tx.execute(sql`
      INSERT INTO meeting_attendees (meeting_id, user_id) VALUES (${meetingId}, ${userId})
      ON CONFLICT (meeting_id, user_id) DO UPDATE
        SET removed_at = NULL, response = 'pending', responded_at = NULL, added_at = now()
        WHERE meeting_attendees.removed_at IS NOT NULL
    `);
  }
}

/** Soft-removes attendees: their access and future reminders end. */
export async function removeAttendees(tx: Tx, meetingId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx
    .update(meetingAttendees)
    .set({ removedAt: sql`now()` })
    .where(and(eq(meetingAttendees.meetingId, meetingId), inArray(meetingAttendees.userId, [...userIds]), isNull(meetingAttendees.removedAt)));
}

/** Resets every current attendee's response to pending. Returns how many responses changed. */
export async function resetResponses(tx: Tx, meetingId: string): Promise<number> {
  const result = await tx.execute<{ count: number }>(sql`
    WITH reset AS (
      UPDATE meeting_attendees SET response = 'pending', responded_at = NULL
      WHERE meeting_id = ${meetingId} AND removed_at IS NULL AND response <> 'pending'
      RETURNING 1
    )
    SELECT count(*)::int AS count FROM reset
  `);
  return result.rows[0]?.count ?? 0;
}

export async function setResponse(tx: Tx, meetingId: string, userId: string, response: MeetingResponse): Promise<void> {
  await tx
    .update(meetingAttendees)
    .set({ response, respondedAt: response === "pending" ? null : sql`now()` })
    .where(and(eq(meetingAttendees.meetingId, meetingId), eq(meetingAttendees.userId, userId), isNull(meetingAttendees.removedAt)));
}

/** Writes the edited fields and the next version; `timeChanged` also stamps responses_reset_at. */
export async function updateMeeting(
  tx: Tx,
  id: string,
  fields: Partial<
    Pick<
      typeof meetings.$inferInsert,
      "title" | "description" | "startsAt" | "endsAt" | "location" | "meetingUrl" | "projectId" | "taskId"
    >
  >,
  timeChanged: boolean,
): Promise<void> {
  await tx
    .update(meetings)
    .set({
      ...fields,
      version: sql`${meetings.version} + 1`,
      updatedAt: sql`now()`,
      ...(timeChanged ? { responsesResetAt: sql`now()` } : {}),
    })
    .where(eq(meetings.id, id));
}

export async function cancelMeeting(tx: Tx, id: string): Promise<void> {
  await tx
    .update(meetings)
    .set({ status: "cancelled", cancelledAt: sql`now()`, version: sql`${meetings.version} + 1`, updatedAt: sql`now()` })
    .where(eq(meetings.id, id));
}

/** One meetings.reminder_due event per reminder time, keyed by meeting, version and offset. */
export async function insertReminders(
  tx: Tx,
  meetingId: string,
  version: number,
  reminders: readonly { minutesBefore: ReminderOffset; at: Date }[],
): Promise<void> {
  for (const reminder of reminders) {
    const payload = JSON.stringify({ meetingId, version, minutesBefore: reminder.minutesBefore });
    await tx.execute(sql`
      INSERT INTO outbox_events (event_type, payload, dedupe_key, available_at)
      VALUES ('meetings.reminder_due', ${payload}::jsonb,
              ${`meeting:${meetingId}:v${String(version)}:m${String(reminder.minutesBefore)}`},
              ${reminder.at.toISOString()}::timestamptz)
    `);
  }
}

/** Exact counts in the organisation's time zone. Never limited. */
export async function summaryCounts(db: Executor, timeZone: string) {
  const result = await db.execute<{
    today: number;
    this_week: number;
    cancelled_7: number;
    held_30: number;
    accepted: number;
    declined: number;
    pending: number;
  }>(sql`
    WITH bounds AS (
      SELECT date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone} AS day_start,
             date_trunc('week', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone} AS week_start
    )
    SELECT
      (SELECT count(*)::int FROM meetings, bounds WHERE status = 'scheduled'
         AND starts_at >= day_start AND starts_at < day_start + interval '1 day') AS today,
      (SELECT count(*)::int FROM meetings, bounds WHERE status = 'scheduled'
         AND starts_at >= week_start AND starts_at < week_start + interval '7 days') AS this_week,
      (SELECT count(*)::int FROM meetings WHERE status = 'cancelled' AND cancelled_at > now() - interval '7 days') AS cancelled_7,
      (SELECT count(*)::int FROM meetings WHERE status = 'scheduled' AND ends_at <= now()
         AND ends_at > now() - interval '30 days') AS held_30,
      (SELECT count(*) FILTER (WHERE a.response = 'accepted')::int FROM meeting_attendees a JOIN meetings m ON m.id = a.meeting_id
         WHERE m.status = 'scheduled' AND m.starts_at > now() AND a.removed_at IS NULL) AS accepted,
      (SELECT count(*) FILTER (WHERE a.response = 'declined')::int FROM meeting_attendees a JOIN meetings m ON m.id = a.meeting_id
         WHERE m.status = 'scheduled' AND m.starts_at > now() AND a.removed_at IS NULL) AS declined,
      (SELECT count(*) FILTER (WHERE a.response = 'pending')::int FROM meeting_attendees a JOIN meetings m ON m.id = a.meeting_id
         WHERE m.status = 'scheduled' AND m.starts_at > now() AND a.removed_at IS NULL) AS pending
  `);
  const row = result.rows[0];
  return {
    today: row?.today ?? 0,
    thisWeek: row?.this_week ?? 0,
    cancelledLast7Days: row?.cancelled_7 ?? 0,
    heldLast30Days: row?.held_30 ?? 0,
    upcomingAccepted: row?.accepted ?? 0,
    upcomingDeclined: row?.declined ?? 0,
    upcomingPending: row?.pending ?? 0,
  };
}

/** The next scheduled meetings for the summary. */
export function nextMeetings(db: Executor, viewerId: string, limit: number) {
  return db
    .select(meetingColumns)
    .from(meetings)
    .leftJoin(meetingAttendees, viewerJoin(viewerId))
    .where(and(eq(meetings.status, "scheduled"), gt(meetings.startsAt, sql`now()`)))
    .orderBy(asc(meetings.startsAt), asc(meetings.id))
    .limit(limit);
}
