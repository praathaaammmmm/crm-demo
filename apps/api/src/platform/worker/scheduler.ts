import type { Database } from "@crm/database/client";
import { sql } from "drizzle-orm";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Recurring system events allowed by outbox_schedule_system_event() (migration 0003), with their intervals. */
export const SYSTEM_SCHEDULE: readonly { eventType: string; intervalMs: number }[] = [
  { eventType: "identity.session_expiry_sweep", intervalMs: FIVE_MINUTES_MS },
  { eventType: "system.health_check", intervalMs: FIVE_MINUTES_MS },
];

/** The slot a time falls in: floor(now / interval) × interval, aligned to the Unix epoch (and 2000-01-01). */
export function slotFor(now: Date, intervalMs: number): Date {
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
}

/**
 * Asks the database to schedule each system event for the current slot. The function builds the row
 * itself and ignores duplicates, so several workers can call this safely.
 */
export async function scheduleSystemEvents(db: Database, now: Date = new Date()): Promise<void> {
  for (const { eventType, intervalMs } of SYSTEM_SCHEDULE) {
    const slot = slotFor(now, intervalMs).toISOString();
    await db.execute(sql`SELECT outbox_schedule_system_event(${eventType}, ${slot}::timestamptz)`);
  }
}
