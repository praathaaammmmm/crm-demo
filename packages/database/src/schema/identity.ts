import { sql } from "drizzle-orm";
import { check, customType, foreignKey, index, pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const sessionEndReason = pgEnum("session_end_reason", ["logout", "expired", "revoked"]);
export const attendanceKind = pgEnum("attendance_kind", ["login", "session_end"]);

/**
 * Sessions last exactly 12 hours. created_at and expires_at are set by database defaults;
 * application roles have no grant on either column. No activity or device data is stored.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '12 hours'`),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: sessionEndReason("end_reason"),
  },
  (t) => [
    unique("sessions_token_hash_unique").on(t.tokenHash),
    unique("sessions_id_user_unique").on(t.id, t.userId),
    index("sessions_active_expiry_idx").on(t.expiresAt).where(sql`ended_at IS NULL`),
    index("sessions_active_user_idx").on(t.userId).where(sql`ended_at IS NULL`),
    check("sessions_token_hash_length", sql`octet_length(token_hash) = 32`),
    check("sessions_fixed_duration", sql`expires_at = created_at + interval '12 hours'`),
    check("sessions_end_fields", sql`(ended_at IS NULL) = (end_reason IS NULL)`),
    check("sessions_ended_after_created", sql`ended_at IS NULL OR ended_at >= created_at`),
    check("sessions_expired_at_expiry", sql`end_reason IS DISTINCT FROM 'expired' OR ended_at = expires_at`),
  ],
);

/** Append-only for application roles: INSERT only, no UPDATE or DELETE grants. */
export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: uuid("session_id").notNull(),
    kind: attendanceKind("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "attendance_events_session_user_fk",
      columns: [t.sessionId, t.userId],
      foreignColumns: [sessions.id, sessions.userId],
    }),
    unique("attendance_events_session_kind_unique").on(t.sessionId, t.kind),
    index("attendance_events_user_occurred_idx").on(t.userId, t.occurredAt),
  ],
);
