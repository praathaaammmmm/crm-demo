import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

export const approvalType = pgEnum("approval_type", ["user.role_change", "user.deactivate"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "cancelled"]);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    type: approvalType("type").notNull(),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (t) => [
    uniqueIndex("approval_requests_one_pending").on(t.type, t.targetUserId).where(sql`status = 'pending'`),
    index("approval_requests_requester_idx").on(t.requestedBy, t.requestedAt),
    index("approval_requests_status_idx").on(t.status, t.requestedAt),
    check("approval_requests_payload_object", sql`jsonb_typeof(payload) = 'object'`),
    check("approval_requests_reason_length", sql`char_length(reason) BETWEEN 1 AND 500`),
    check(
      "approval_requests_note_length",
      sql`decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 500`,
    ),
    check("approval_requests_not_self", sql`requested_by <> target_user_id`),
    check("approval_requests_decided_at", sql`(status = 'pending') = (decided_at IS NULL)`),
    check(
      "approval_requests_decided_by",
      sql`(status IN ('approved', 'rejected')) = (decided_by IS NOT NULL)`,
    ),
    check("approval_requests_reject_note", sql`status <> 'rejected' OR decision_note IS NOT NULL`),
  ],
);
