import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { Handler } from "./handlers.js";

/**
 * system.health_check: confirms the database answers and logs a warning when events are overdue by more
 * than 10 minutes or have failed in the last 24 hours. Writes nothing except its own event status.
 */
export function healthCheckHandler(logger: Logger): Handler {
  return async (tx) => {
    const result = await tx.execute<{ overdue: number; failed: number }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending' AND available_at < now() - interval '10 minutes')::int AS overdue,
        count(*) FILTER (WHERE status = 'failed' AND processed_at > now() - interval '24 hours')::int AS failed
      FROM outbox_events
    `);
    const row = result.rows[0];
    const overdue = row?.overdue ?? 0;
    const failed = row?.failed ?? 0;
    if (overdue > 0 || failed > 0) logger.warn({ overdue, failed }, "outbox health check found overdue or failed events");
    return "done";
  };
}
