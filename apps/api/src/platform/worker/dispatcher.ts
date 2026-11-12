import type { Database } from "@crm/database/client";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { HandlerError, type ClaimedEvent, type HandlerRegistry } from "./handlers.js";

/** Claim locks last this long; a crashed worker's events are reclaimed after it. */
export const LOCK_SECONDS = 60;
export const BATCH_SIZE = 10;

/** Retry delay after a failed attempt: 10 s × 2^attempts, at most 10 minutes. */
export function backoffSeconds(attempts: number): number {
  return Math.min(10 * 2 ** attempts, 600);
}

/** A short, safe error code for last_error: never a message, query text or payload. */
export function errorCode(error: unknown): string {
  if (error instanceof HandlerError) return error.code.slice(0, 100);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `pg_${code}`;
    current = current.cause;
  }
  return "handler_error";
}

/** Claims due events (and events whose lock expired) in one short transaction. */
export async function claimEvents(db: Database, workerId: string, limit = BATCH_SIZE): Promise<ClaimedEvent[]> {
  const result = await db.execute<{ id: string; event_type: string; payload: unknown; attempts: number; max_attempts: number }>(sql`
    UPDATE outbox_events
    SET status = 'processing', locked_by = ${workerId},
        locked_until = now() + make_interval(secs => ${LOCK_SECONDS}), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE (status = 'pending' AND available_at <= now())
         OR (status = 'processing' AND locked_until < now())
      ORDER BY available_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, event_type, payload, attempts, max_attempts
  `);
  return result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  }));
}

/** Final status, only while this worker still holds the claim. */
const finish = (status: "done" | "cancelled" | "failed", id: string, workerId: string, lastError: string | null) => sql`
  UPDATE outbox_events
  SET status = ${status}::outbox_status, processed_at = now(), last_error = ${lastError}
  WHERE id = ${id} AND status = 'processing' AND locked_by = ${workerId}
`;

/**
 * Runs one event's handler in its own transaction together with the status update. On error, retries
 * with back-off until max_attempts, then marks the event failed. Unknown event types fail immediately.
 */
export async function processEvent(
  db: Database,
  handlers: HandlerRegistry,
  event: ClaimedEvent,
  workerId: string,
  logger: Logger,
): Promise<void> {
  const handler = handlers[event.eventType];
  if (handler === undefined) {
    await db.execute(finish("failed", event.id, workerId, "unknown_event_type"));
    logger.warn({ eventId: event.id, eventType: event.eventType }, "outbox event has no handler");
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const result = await handler(tx, event);
      await tx.execute(finish(result, event.id, workerId, null));
    });
  } catch (error) {
    const code = errorCode(error);
    if (event.attempts < event.maxAttempts) {
      await db.execute(sql`
        UPDATE outbox_events
        SET status = 'pending', available_at = now() + make_interval(secs => ${backoffSeconds(event.attempts)}),
            locked_by = NULL, locked_until = NULL, last_error = ${code}
        WHERE id = ${event.id} AND status = 'processing' AND locked_by = ${workerId}
      `);
    } else {
      await db.execute(finish("failed", event.id, workerId, code));
    }
    logger.warn({ eventId: event.id, eventType: event.eventType, attempts: event.attempts, code }, "outbox event failed");
  }
}

/** Claims one batch and processes it. Returns how many events were claimed. */
export async function dispatchOnce(db: Database, handlers: HandlerRegistry, workerId: string, logger: Logger): Promise<number> {
  const events = await claimEvents(db, workerId);
  for (const event of events) await processEvent(db, handlers, event, workerId, logger);
  return events.length;
}
