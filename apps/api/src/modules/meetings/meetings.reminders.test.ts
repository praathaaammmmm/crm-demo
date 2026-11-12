import { meetingResponseBodySchema, type Meeting } from "@crm/contracts/meetings";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, localDateTimeIn, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";
import { dispatchOnce } from "../../platform/worker/dispatcher.js";
import { meetingReminderHandler } from "./meetings.reminders.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const ALICE = person("alice");
const BOB = person("bob");
const CARA = person("cara");

const silent = pino({ level: "silent" });
const handlers = { "meetings.reminder_due": meetingReminderHandler };

describe("meeting reminders (worker, as crm_worker)", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const id = (key: string) => ids[key] ?? "";
  const as = (key: string) => tokens[key] ?? "";

  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const patch = (url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as("ceo") }, payload });
  const create = async (attendees: string[]): Promise<Meeting> => {
    const response = await post("ceo", "/api/v1/meetings", {
      title: "Stand-up",
      startsAtLocal: localDateTimeIn(60),
      durationMinutes: 15,
      attendeeIds: attendees.map(id),
    });
    expect(response.statusCode).toBe(201);
    return meetingResponseBodySchema.parse(response.json()).meeting;
  };
  /**
   * Makes a meeting's reminder events due now, then runs the real dispatcher. Test-only, as crm_migrator
   * on the throwaway database: the outbox guard allows pending → processing, so each event gets an
   * already-expired test lock, which the dispatcher reclaims through its normal claim path.
   */
  const fireReminders = async (meetingId: string, version: number) => {
    await db.query(
      `UPDATE outbox_events SET status = 'processing', locked_by = 'test-expired-lock', locked_until = now() - interval '1 second'
       WHERE dedupe_key LIKE $1 AND status = 'pending'`,
      [
      `meeting:${meetingId}:v${String(version)}:%`,
    ]);
    while ((await dispatchOnce(db.worker, handlers, "test-worker", silent)) > 0) {
      // drain
    }
  };
  const eventStatuses = async (meetingId: string, version: number) =>
    (
      await db.query<{ status: string }>("SELECT status FROM outbox_events WHERE dedupe_key LIKE $1 ORDER BY dedupe_key", [
        `meeting:${meetingId}:v${String(version)}:%`,
      ])
    ).map((row) => row.status);
  const recipients = async (meetingId: string, version: number) =>
    (
      await db.query<{ recipient_id: string }>(
        "SELECT DISTINCT recipient_id FROM notifications WHERE meeting_id = $1 AND meeting_version = $2 ORDER BY recipient_id",
        [meetingId, version],
      )
    ).map((row) => row.recipient_id);
  const sorted = (...keys: string[]) => keys.map(id).sort();

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    ids["bob"] = await createUser(db.migrator, { ...BOB, role: "intern" });
    ids["cara"] = await createUser(db.migrator, { ...CARA, role: "contractor" });
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["alice", ALICE], ["bob", BOB], ["cara", CARA]] as const) {
      tokens[key] = await loginToken(setupApp, who.email, who.password);
    }
    await setupApp.close();
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });
  beforeEach(async () => {
    app = await buildTestApp(db.app);
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
  });

  it("notifies current, active attendees who have not declined, once per reminder", async () => {
    const meeting = await create(["alice", "bob", "cara"]);
    await post("bob", `/api/v1/meetings/${meeting.id}/response`, { response: "declined" });
    await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" });
    await db.query("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = $1", [id("cara")]);

    await fireReminders(meeting.id, 1);
    expect(await eventStatuses(meeting.id, 1)).toEqual(["done", "done", "done"]);
    expect(await recipients(meeting.id, 1)).toEqual(sorted("ceo", "alice"));
    const [count] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE meeting_id = $1", [meeting.id]);
    expect(count?.n).toBe(6); // 2 recipients × 3 reminders

    // Running the handler again for the same event creates nothing new.
    const [event] = await db.query<{ id: string; payload: unknown }>("SELECT id, payload FROM outbox_events WHERE dedupe_key = $1", [
      `meeting:${meeting.id}:v1:m2`,
    ]);
    if (!event) throw new Error("missing event");
    await db.worker.transaction((tx) =>
      meetingReminderHandler(tx, { id: event.id, eventType: "meetings.reminder_due", payload: event.payload, attempts: 1, maxAttempts: 5 }),
    );
    const [again] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE meeting_id = $1", [meeting.id]);
    expect(again?.n).toBe(6);
    await db.query("UPDATE users SET status = 'active', deactivated_at = NULL WHERE id = $1", [id("cara")]);
  });

  it("cancels stale reminders after a reschedule; the new version notifies people whose decline was reset", async () => {
    const meeting = await create(["alice", "bob"]);
    await post("bob", `/api/v1/meetings/${meeting.id}/response`, { response: "declined" });
    expect((await patch(`/api/v1/meetings/${meeting.id}`, { startsAtLocal: localDateTimeIn(80) })).statusCode).toBe(200);

    await fireReminders(meeting.id, 1);
    expect(await eventStatuses(meeting.id, 1)).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(await recipients(meeting.id, 1)).toEqual([]);

    await fireReminders(meeting.id, 2);
    expect(await eventStatuses(meeting.id, 2)).toEqual(["done", "done", "done"]);
    expect(await recipients(meeting.id, 2)).toEqual(sorted("ceo", "alice", "bob"));
  });

  it("cancels reminders for cancelled meetings, meetings that already started, and skips removed attendees", async () => {
    const cancelled = await create(["alice"]);
    await post("ceo", `/api/v1/meetings/${cancelled.id}/cancel`);
    await fireReminders(cancelled.id, 1);
    expect(await eventStatuses(cancelled.id, 1)).toEqual(["cancelled", "cancelled", "cancelled"]);

    const started = await create(["alice"]);
    await db.query("UPDATE meetings SET starts_at = now() - interval '1 minute' WHERE id = $1", [started.id]);
    await fireReminders(started.id, 1);
    expect(await eventStatuses(started.id, 1)).toEqual(["cancelled", "cancelled", "cancelled"]);

    const trimmed = await create(["alice", "bob"]);
    await patch(`/api/v1/meetings/${trimmed.id}`, { attendeeIds: [id("alice")] });
    await fireReminders(trimmed.id, 2);
    expect(await recipients(trimmed.id, 2)).toEqual(sorted("ceo", "alice"));
  });
});
