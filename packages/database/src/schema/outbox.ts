import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const outboxStatus = pgEnum("outbox_status", ["pending", "processing", "done", "cancelled", "failed"]);

/**
 * Transactional outbox. Status changes and immutable columns are enforced by triggers (migration 0003).
 * See docs/architecture/outbox.md.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dedupeKey: text("dedupe_key").notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("outbox_events_dedupe_key_unique").on(t.dedupeKey),
    index("outbox_events_status_available_idx").on(t.status, t.availableAt),
    check("outbox_events_event_type_format", sql`event_type ~ '^[a-z_]+\\.[a-z_]+$'`),
    check("outbox_events_payload_object", sql`jsonb_typeof(payload) = 'object'`),
    check("outbox_events_dedupe_key_length", sql`char_length(dedupe_key) BETWEEN 1 AND 200`),
    check("outbox_events_attempts", sql`attempts >= 0`),
    check("outbox_events_max_attempts", sql`max_attempts BETWEEN 1 AND 20`),
    check("outbox_events_last_error_length", sql`last_error IS NULL OR char_length(last_error) <= 500`),
    check(
      "outbox_events_processing_lock",
      sql`status <> 'processing' OR (locked_by IS NOT NULL AND locked_until IS NOT NULL)`,
    ),
    check(
      "outbox_events_processed_at",
      sql`(status IN ('done', 'cancelled', 'failed')) = (processed_at IS NOT NULL)`,
    ),
  ],
);
