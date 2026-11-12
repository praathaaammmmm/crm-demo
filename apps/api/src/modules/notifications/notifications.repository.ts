import { meetingAttendees, meetings, notifications } from "@crm/database/schema";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

/**
 * Notification columns plus the current meeting, joined in only while the recipient may still see it:
 * everyone with read-all access, or a current (not removed) attendee.
 */
const columns = (canReadAll: boolean) => ({
  id: notifications.id,
  kind: notifications.kind,
  meetingId: notifications.meetingId,
  meetingVersion: notifications.meetingVersion,
  minutesBefore: notifications.minutesBefore,
  createdAt: notifications.createdAt,
  readAt: notifications.readAt,
  visible: canReadAll ? sql<boolean>`true` : sql<boolean>`${meetingAttendees.userId} IS NOT NULL`,
  meetingTitle: meetings.title,
  meetingStartsAt: meetings.startsAt,
  meetingStatus: meetings.status,
  meetingCurrentVersion: meetings.version,
});

export type NotificationRow = Awaited<ReturnType<typeof listForRecipient>>[number];

export function listForRecipient(
  db: Executor,
  filter: { recipientId: string; canReadAll: boolean; unread: boolean | undefined; cursor: string | undefined; limit: number },
) {
  const conditions: SQL[] = [eq(notifications.recipientId, filter.recipientId)];
  if (filter.unread === true) conditions.push(isNull(notifications.readAt));
  if (filter.unread === false) conditions.push(sql`${notifications.readAt} IS NOT NULL`);
  if (filter.cursor !== undefined) {
    conditions.push(sql`(${notifications.createdAt}, ${notifications.id}) < (SELECT created_at, id FROM notifications WHERE id = ${filter.cursor})`);
  }
  return db
    .select(columns(filter.canReadAll))
    .from(notifications)
    .innerJoin(meetings, eq(meetings.id, notifications.meetingId))
    .leftJoin(
      meetingAttendees,
      and(
        eq(meetingAttendees.meetingId, notifications.meetingId),
        eq(meetingAttendees.userId, filter.recipientId),
        isNull(meetingAttendees.removedAt),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(filter.limit + 1);
}

/** One of the recipient's notifications, with the same visibility rule as the list. */
export async function findForRecipient(db: Executor, id: string, recipientId: string, canReadAll: boolean) {
  const rows = await db
    .select(columns(canReadAll))
    .from(notifications)
    .innerJoin(meetings, eq(meetings.id, notifications.meetingId))
    .leftJoin(
      meetingAttendees,
      and(eq(meetingAttendees.meetingId, notifications.meetingId), eq(meetingAttendees.userId, recipientId), isNull(meetingAttendees.removedAt)),
    )
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function unreadCount(db: Executor, recipientId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM notifications WHERE recipient_id = ${recipientId} AND read_at IS NULL`,
  );
  return result.rows[0]?.count ?? 0;
}

/** Marks one notification read; already-read notifications keep their first read time. */
export async function markRead(tx: Tx, id: string, recipientId: string): Promise<void> {
  await tx
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));
}

export async function markAllRead(tx: Tx, recipientId: string): Promise<number> {
  const result = await tx.execute<{ count: number }>(sql`
    WITH marked AS (
      UPDATE notifications SET read_at = now() WHERE recipient_id = ${recipientId} AND read_at IS NULL RETURNING 1
    )
    SELECT count(*)::int AS count FROM marked
  `);
  return result.rows[0]?.count ?? 0;
}
