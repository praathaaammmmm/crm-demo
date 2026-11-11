import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";
import { projects } from "./projects.js";
import { tasks } from "./tasks.js";

export const meetingState = pgEnum("meeting_state", ["scheduled", "cancelled"]);
export const meetingResponse = pgEnum("meeting_response", ["pending", "accepted", "declined"]);
export const notificationKind = pgEnum("notification_kind", ["meeting_reminder"]);

/**
 * A meeting organised by the CEO/CTO. Every edit or cancellation increments `version`, which makes
 * reminder events for older versions stale (see docs/architecture/outbox.md).
 */
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    meetingUrl: text("meeting_url"),
    projectId: uuid("project_id").references(() => projects.id),
    taskId: uuid("task_id"),
    status: meetingState("status").notNull().default("scheduled"),
    version: integer("version").notNull().default(1),
    organizerId: uuid("organizer_id").notNull(),
    organizerIsSuperAdmin: boolean("organizer_is_super_admin").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    responsesResetAt: timestamp("responses_reset_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "meetings_task_project_fk", columns: [t.taskId, t.projectId], foreignColumns: [tasks.id, tasks.projectId] }),
    foreignKey({
      name: "meetings_organizer_fk",
      columns: [t.organizerId, t.organizerIsSuperAdmin],
      foreignColumns: [users.id, users.isSuperAdmin],
    }),
    index("meetings_starts_at_idx").on(t.startsAt),
    index("meetings_status_starts_at_idx").on(t.status, t.startsAt),
    check("meetings_time_order", sql`ends_at > starts_at`),
    check("meetings_max_duration", sql`ends_at - starts_at <= interval '12 hours'`),
    check("meetings_title_length", sql`char_length(title) BETWEEN 1 AND 200`),
    check("meetings_description_length", sql`char_length(description) <= 5000`),
    check("meetings_location_length", sql`location IS NULL OR char_length(location) BETWEEN 1 AND 500`),
    check(
      "meetings_url_https",
      sql`meeting_url IS NULL OR (meeting_url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(meeting_url) <= 2000)`,
    ),
    check("meetings_version_positive", sql`version >= 1`),
    check("meetings_cancelled_at", sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`),
    check("meetings_task_needs_project", sql`task_id IS NULL OR project_id IS NOT NULL`),
    check("meetings_organizer_super_admin", sql`organizer_is_super_admin = true`),
    check("meetings_responses_reset_after_create", sql`responses_reset_at IS NULL OR responses_reset_at >= created_at`),
  ],
);

/** Attendees are never deleted: removal sets removed_at, which ends access and future reminders. */
export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    response: meetingResponse("response").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "meeting_attendees_pk", columns: [t.meetingId, t.userId] }),
    index("meeting_attendees_user_idx").on(t.userId, t.meetingId),
    check("meeting_attendees_responded_at", sql`(response = 'pending') = (responded_at IS NULL)`),
  ],
);

/** In-app notifications. No free text: titles and times are read from the meeting when shown. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    kind: notificationKind("kind").notNull(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    meetingVersion: integer("meeting_version").notNull(),
    minutesBefore: integer("minutes_before").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    unique("notifications_source_recipient_unique").on(t.sourceEventId, t.recipientId),
    index("notifications_recipient_idx").on(t.recipientId, t.readAt, t.createdAt),
    check("notifications_minutes_before", sql`minutes_before IN (10, 5, 2)`),
    check("notifications_version_positive", sql`meeting_version >= 1`),
    check("notifications_read_after_create", sql`read_at IS NULL OR read_at >= created_at`),
  ],
);
