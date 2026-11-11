import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

export const auditActorType = pgEnum("audit_actor_type", ["user", "system", "bootstrap", "anonymous"]);

/**
 * Append-only. Triggers reject UPDATE, DELETE and TRUNCATE for every role (migration 0002).
 * occurred_at is always set by the database. See docs/security/audit-policy.md.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    index("audit_events_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_events_occurred_idx").on(t.occurredAt),
    check("audit_events_actor", sql`(actor_type = 'user') = (actor_user_id IS NOT NULL)`),
    check("audit_events_action_format", sql`action ~ '^[a-z_]+\\.[a-z_]+$'`),
    check("audit_events_entity_type_format", sql`entity_type ~ '^[a-z_]+$'`),
    check("audit_events_before_object", sql`before IS NULL OR jsonb_typeof(before) = 'object'`),
    check("audit_events_after_object", sql`after IS NULL OR jsonb_typeof(after) = 'object'`),
    check("audit_events_request_id_length", sql`request_id IS NULL OR char_length(request_id) <= 100`),
  ],
);
