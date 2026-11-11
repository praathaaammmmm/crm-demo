import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";
import { meetingStateSchema } from "./meetings.js";

export const NOTIFICATION_KINDS = ["meeting_reminder"] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

export const notificationListQuerySchema = paginationQuerySchema.extend({ unread: z.enum(["true", "false"]).optional() });
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/**
 * Notifications store no text. The current meeting title and time are joined in, and only while the
 * recipient may still see the meeting; otherwise `meeting` is null.
 */
export const notificationSchema = z.strictObject({
  id: z.uuid(),
  kind: notificationKindSchema,
  meetingId: z.uuid(),
  meetingVersion: z.int().min(1),
  minutesBefore: z.union([z.literal(10), z.literal(5), z.literal(2)]),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  meeting: z
    .strictObject({
      title: z.string(),
      startsAt: z.iso.datetime(),
      status: meetingStateSchema,
      version: z.int().min(1),
    })
    .nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationPageSchema = z.strictObject({ items: z.array(notificationSchema), nextCursor: nextCursorSchema });
export const notificationResponseSchema = z.strictObject({ notification: notificationSchema });
export const unreadCountSchema = z.strictObject({ count: z.int().nonnegative() });
export const readAllResponseSchema = z.strictObject({ updated: z.int().nonnegative() });

/** "Rescheduled" or "Cancelled" when the meeting changed after the reminder was created. */
export function reminderState(notification: Pick<Notification, "meetingVersion" | "meeting">): "current" | "rescheduled" | "cancelled" | "unavailable" {
  if (notification.meeting === null) return "unavailable";
  if (notification.meeting.status === "cancelled") return "cancelled";
  return notification.meeting.version === notification.meetingVersion ? "current" : "rescheduled";
}
