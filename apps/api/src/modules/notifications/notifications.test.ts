import { meetingResponseBodySchema } from "@crm/contracts/meetings";
import { notificationPageSchema, notificationResponseSchema, readAllResponseSchema, unreadCountSchema } from "@crm/contracts/notifications";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, localDateTimeIn, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const ALICE = person("alice");
const BOB = person("bob");

describe("notifications", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let meetingId = "";
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });

  /** Test-only notification rows, inserted as crm_migrator (the worker creates them in production). */
  const notify = async (recipient: string, minutesBefore: number) => {
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO notifications (recipient_id, kind, meeting_id, meeting_version, minutes_before, source_event_id)
       VALUES ($1, 'meeting_reminder', $2, 1, $3, gen_random_uuid()) RETURNING id`,
      [ids[recipient], meetingId, minutesBefore],
    );
    return row?.id ?? "";
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    ids["bob"] = await createUser(db.migrator, { ...BOB, role: "employee" });
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["alice", ALICE], ["bob", BOB]] as const) {
      tokens[key] = await loginToken(setupApp, who.email, who.password);
    }
    const created = await call(setupApp, {
      method: "POST",
      url: "/api/v1/meetings",
      token: as("ceo"),
      payload: { title: "Review", startsAtLocal: localDateTimeIn(60), durationMinutes: 30, attendeeIds: [ids["alice"], ids["bob"]] },
    });
    meetingId = meetingResponseBodySchema.parse(created.json()).meeting.id;
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

  it("lists only the caller's notifications, newest first, with the current meeting title and time", async () => {
    await notify("alice", 10);
    const latest = await notify("alice", 5);
    await notify("bob", 10);
    const page = notificationPageSchema.parse((await get("alice", "/api/v1/notifications")).json());
    expect(page.items.map((n) => n.id)[0]).toBe(latest);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ minutesBefore: 5, readAt: null, meeting: { title: "Review", status: "scheduled", version: 1 } });
    expect(unreadCountSchema.parse((await get("alice", "/api/v1/notifications/unread-count")).json()).count).toBe(2);
  });

  it("marks one read (others' are 404) and all read", async () => {
    const own = await notify("alice", 2);
    const others = await notify("bob", 2);
    expect((await post("alice", `/api/v1/notifications/${others}/read`)).statusCode).toBe(404);
    const read = notificationResponseSchema.parse((await post("alice", `/api/v1/notifications/${own}/read`)).json());
    expect(read.notification.readAt).not.toBeNull();
    const all = readAllResponseSchema.parse((await post("alice", "/api/v1/notifications/read-all")).json());
    expect(all.updated).toBe(2);
    expect(unreadCountSchema.parse((await get("alice", "/api/v1/notifications/unread-count")).json()).count).toBe(0);
    expect(unreadCountSchema.parse((await get("bob", "/api/v1/notifications/unread-count")).json()).count).toBeGreaterThan(0);
  });

  it("hides meeting details once the recipient is removed from the meeting", async () => {
    await notify("bob", 5);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/meetings/${meetingId}`,
      headers: { origin: TEST_ORIGIN },
      cookies: { crm_session: as("ceo") },
      payload: { attendeeIds: [ids["alice"]] },
    });
    expect(response.statusCode).toBe(200);
    const page = notificationPageSchema.parse((await get("bob", "/api/v1/notifications")).json());
    expect(page.items.every((n) => n.meeting === null)).toBe(true);
  });
});
