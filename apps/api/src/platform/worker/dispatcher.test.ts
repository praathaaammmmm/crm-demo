import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { createSuperAdmin } from "../../../test/helpers.js";
import { backoffSeconds, claimEvents, dispatchOnce, errorCode } from "./dispatcher.js";
import { HandlerError, type HandlerRegistry } from "./handlers.js";
import { healthCheckHandler } from "./health-check.js";
import { scheduleSystemEvents, slotFor, SYSTEM_SCHEDULE } from "./scheduler.js";

const silent = pino({ level: "silent" });

describe("backoff and error codes", () => {
  it("doubles from 10 seconds up to 10 minutes", () => {
    expect([1, 2, 3, 6, 7, 20].map(backoffSeconds)).toEqual([20, 40, 80, 600, 600, 600]);
  });

  it("stores only short codes, never messages", () => {
    expect(errorCode(new HandlerError("invalid_payload"))).toBe("invalid_payload");
    expect(errorCode(Object.assign(new Error("secret detail"), { code: "23505" }))).toBe("pg_23505");
    expect(errorCode(new Error("secret detail"))).toBe("handler_error");
  });

  it("aligns slots to the interval", () => {
    expect(slotFor(new Date("2026-11-20T10:07:31.000Z"), 5 * 60_000).toISOString()).toBe("2026-11-20T10:05:00.000Z");
  });
});

describe("worker dispatcher and scheduler (as crm_worker)", () => {
  let db: TestDatabase;

  /** Test-only event rows, inserted as crm_migrator into the throwaway database. */
  const insertEvent = async (eventType: string, key: string, maxAttempts = 5) => {
    const [row] = await db.query<{ id: string }>(
      "INSERT INTO outbox_events (event_type, dedupe_key, max_attempts) VALUES ($1, $2, $3) RETURNING id",
      [eventType, key, maxAttempts],
    );
    return row?.id ?? "";
  };
  const eventOf = async (id: string) => {
    const [row] = await db.query<{ status: string; attempts: number; last_error: string | null; delayed: boolean }>(
      "SELECT status, attempts, last_error, available_at > now() AS delayed FROM outbox_events WHERE id = $1",
      [id],
    );
    if (!row) throw new Error("missing event");
    return row;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("completes or cancels events in the handler's transaction; retries with back-off; fails at max attempts and unknown types", async () => {
    const handlers: HandlerRegistry = {
      "test.ok": () => Promise.resolve("done"),
      "test.skip": () => Promise.resolve("cancelled"),
      "test.boom": () => Promise.reject(new HandlerError("boom")),
    };
    const ok = await insertEvent("test.ok", "t:ok");
    const skip = await insertEvent("test.skip", "t:skip");
    const boom = await insertEvent("test.boom", "t:boom");
    const last = await insertEvent("test.boom", "t:last", 1);
    const unknown = await insertEvent("test.unknown", "t:unknown");

    expect(await dispatchOnce(db.worker, handlers, "w1", silent)).toBe(5);
    expect(await eventOf(ok)).toMatchObject({ status: "done", attempts: 1, last_error: null });
    expect(await eventOf(skip)).toMatchObject({ status: "cancelled" });
    expect(await eventOf(boom)).toMatchObject({ status: "pending", attempts: 1, last_error: "boom", delayed: true });
    expect(await eventOf(last)).toMatchObject({ status: "failed", attempts: 1, last_error: "boom" });
    expect(await eventOf(unknown)).toMatchObject({ status: "failed", last_error: "unknown_event_type" });
    // The delayed retry is not claimed yet.
    expect(await dispatchOnce(db.worker, handlers, "w1", silent)).toBe(0);
  });

  it("skips rows locked by another worker and reclaims events whose lock expired", async () => {
    const locked = await insertEvent("test.ok", "t:locked");
    const expired = await insertEvent("test.ok", "t:expired");
    await db.query(
      "UPDATE outbox_events SET status = 'processing', locked_by = 'crashed', locked_until = now() - interval '1 second', attempts = 1 WHERE id = $1",
      [expired],
    );

    // Another transaction holds the row lock while this worker claims.
    let release: () => void = () => undefined;
    let markLocked: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isLocked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holder = db.migrator.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM outbox_events WHERE id = ${locked} FOR UPDATE`);
      markLocked();
      await held;
    });
    await isLocked;
    try {
      const claimed = await claimEvents(db.worker, "w2");
      expect(claimed.map((event) => event.id)).toEqual([expired]);
      expect(claimed[0]?.attempts).toBe(2);
    } finally {
      release();
      await holder;
    }
  });

  it("schedules each allowlisted system event once per slot, even when called twice", async () => {
    const now = new Date();
    await scheduleSystemEvents(db.worker, now);
    await scheduleSystemEvents(db.worker, now);
    for (const { eventType, intervalMs } of SYSTEM_SCHEDULE) {
      const slot = slotFor(now, intervalMs).toISOString().replace(".000Z", "Z");
      const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_events WHERE dedupe_key = $1", [
        `${eventType}:${slot}`,
      ]);
      expect(rows[0]?.n).toBe(1);
    }
  });

  it("health check warns only when events are overdue or failed", async () => {
    const warn = vi.fn();
    const logger = { warn } as unknown as Logger;
    await db.worker.transaction((tx) => healthCheckHandler(logger)(tx, { id: "x", eventType: "system.health_check", payload: {}, attempts: 1, maxAttempts: 5 }));
    expect(warn).toHaveBeenCalledTimes(1); // the failed events from the first test
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ failed: 2 });
  });
});
