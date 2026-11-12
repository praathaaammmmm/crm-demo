import { projectResponseSchema } from "@crm/contracts/projects";
import {
  meetingDetailResponseSchema,
  meetingPageSchema,
  meetingResponseBodySchema,
  meetingSummarySchema,
  type Meeting,
} from "@crm/contracts/meetings";
import { taskResponseSchema } from "@crm/contracts/tasks";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import {
  buildTestApp,
  call,
  createSuperAdmin,
  createUser,
  dateFromToday,
  localDateTimeIn,
  loginToken,
  SUPER_ADMIN,
  TEST_ORIGIN,
  TEST_TIMEZONE,
} from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CFO = person("cfo");
const ALICE = person("alice");
const BOB = person("bob");
const DORA = person("dora");

/** Distinctive free text that must never appear in audit events. */
const SECRET_TEXT = "private-meeting-text-41d2";
const SECRET_URL = "https://example.test/private-call-41d2";

describe("meetings", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const id = (key: string): string => {
    const value = ids[key];
    if (value === undefined) throw new Error(`unknown user ${key}`);
    return value;
  };
  const as = (key: string): string => {
    const value = tokens[key];
    if (value === undefined) throw new Error(`no token for ${key}`);
    return value;
  };
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });
  const meetingOf = (response: { json: () => unknown }): Meeting => meetingResponseBodySchema.parse(response.json()).meeting;

  const create = async (attendees: string[], overrides: object = {}): Promise<Meeting> => {
    const response = await post("ceo", "/api/v1/meetings", {
      title: "Weekly planning",
      description: SECRET_TEXT,
      startsAtLocal: localDateTimeIn(60),
      durationMinutes: 30,
      location: "Room 2",
      meetingUrl: SECRET_URL,
      attendeeIds: attendees.map(id),
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return meetingOf(response);
  };
  const detail = async (who: string, meetingId: string) => {
    const response = await get(who, `/api/v1/meetings/${meetingId}`);
    expect(response.statusCode).toBe(200);
    return meetingDetailResponseSchema.parse(response.json());
  };
  const responsesOf = async (meetingId: string) =>
    Object.fromEntries((await detail("ceo", meetingId)).attendees.map((a) => [a.userId, a.response] as const));
  const reminders = (meetingId: string) =>
    db.query<{ dedupe_key: string; status: string; available_at: Date; payload: Record<string, unknown> }>(
      "SELECT dedupe_key, status, available_at, payload FROM outbox_events WHERE dedupe_key LIKE $1 ORDER BY dedupe_key",
      [`meeting:${meetingId}:%`],
    );
  const lastAudit = async (meetingId: string, action: string) => {
    const rows = await db.query<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
      "SELECT before, after FROM audit_events WHERE entity_type = 'meeting' AND entity_id = $1 AND action = $2 ORDER BY occurred_at DESC, id DESC LIMIT 1",
      [meetingId, action],
    );
    const row = rows[0];
    if (!row) throw new Error("no audit event");
    return row;
  };
  const range = (fromMinutes: number, toMinutes: number) =>
    `from=${encodeURIComponent(new Date(Date.now() + fromMinutes * 60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + toMinutes * 60_000).toISOString())}`;

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    ids["bob"] = await createUser(db.migrator, { ...BOB, role: "founder" });
    ids["dora"] = await createUser(db.migrator, { ...DORA, role: "employee" });
    await db.query("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = $1", [id("dora")]);

    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["cfo", CFO], ["alice", ALICE], ["bob", BOB]] as const) {
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

  it("only the CEO schedules; attendees must be active non-CEO users; the organiser attends; no past starts", async () => {
    const base = { title: "x", startsAtLocal: localDateTimeIn(60), durationMinutes: 30, attendeeIds: [id("alice")] };
    expect((await post("cfo", "/api/v1/meetings", base)).statusCode).toBe(403);
    expect((await post("alice", "/api/v1/meetings", base)).statusCode).toBe(403);
    expect((await post("ceo", "/api/v1/meetings", { ...base, attendeeIds: [id("dora")] })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/meetings", { ...base, attendeeIds: [id("ceo")] })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/meetings", { ...base, startsAtLocal: localDateTimeIn(-5) })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/meetings", { ...base, meetingUrl: "http://example.test/call" })).statusCode).toBe(400);

    const meeting = await create(["alice"]);
    expect(meeting).toMatchObject({ status: "scheduled", version: 1, organizerId: id("ceo"), responsesResetAt: null, viewerResponse: "pending" });
    expect((await detail("ceo", meeting.id)).attendees.map((a) => a.userId)).toEqual([id("ceo"), id("alice")]);
  });

  it("converts wall-clock times in the organisation's time zone to UTC", async () => {
    expect(TEST_TIMEZONE).toBe("Asia/Kolkata");
    const day = dateFromToday(20);
    const meeting = await create(["alice"], { startsAtLocal: `${day}T10:00`, durationMinutes: 45 });
    expect(meeting.startsAt).toBe(`${day}T04:30:00.000Z`);
    expect(meeting.endsAt).toBe(`${day}T05:15:00.000Z`);
  });

  it("validates project and task references", async () => {
    const project = projectResponseSchema.parse((await post("ceo", "/api/v1/projects", { name: "Refs" })).json()).project.id;
    const other = projectResponseSchema.parse((await post("ceo", "/api/v1/projects", { name: "Other" })).json()).project.id;
    const task = taskResponseSchema.parse(
      (await post("ceo", "/api/v1/tasks", { projectId: project, title: "T", priority: "low", dueDate: dateFromToday(3), assigneeId: id("alice") })).json(),
    ).task.id;
    const base = { title: "x", startsAtLocal: localDateTimeIn(60), durationMinutes: 30, attendeeIds: [id("alice")] };
    expect((await post("ceo", "/api/v1/meetings", { ...base, projectId: other, taskId: task })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/meetings", { ...base, projectId: "00000000-0000-7000-8000-000000000000" })).statusCode).toBe(400);
    const linked = await create(["alice"], { projectId: project, taskId: task });
    expect(linked).toMatchObject({ projectId: project, taskId: task });
  });

  it("invitees see only their own meetings; others get 404; removal ends access", async () => {
    const meeting = await create(["alice", "bob"]);
    const listed = async (who: string) => meetingPageSchema.parse((await get(who, `/api/v1/meetings?${range(0, 120)}`)).json()).items.map((m) => m.id);
    expect(await listed("alice")).toContain(meeting.id);
    expect(await listed("cfo")).not.toContain(meeting.id);
    expect(await listed("ceo")).toContain(meeting.id);
    expect((await get("cfo", `/api/v1/meetings/${meeting.id}`)).statusCode).toBe(404);
    expect((await post("cfo", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" })).statusCode).toBe(404);
    expect((await get("alice", "/api/v1/meetings/summary")).statusCode).toBe(403);

    expect((await patch("ceo", `/api/v1/meetings/${meeting.id}`, { attendeeIds: [id("alice")] })).statusCode).toBe(200);
    expect((await get("bob", `/api/v1/meetings/${meeting.id}`)).statusCode).toBe(404);
    expect(await listed("bob")).not.toContain(meeting.id);
  });

  it("queues reminders for each version and skips times already past; cancelling queues none", async () => {
    const meeting = await create(["alice"]);
    const first = await reminders(meeting.id);
    expect(first.map((r) => r.dedupe_key)).toEqual([
      `meeting:${meeting.id}:v1:m10`,
      `meeting:${meeting.id}:v1:m2`,
      `meeting:${meeting.id}:v1:m5`,
    ]);
    const start = Date.parse(meeting.startsAt);
    for (const row of first) {
      const minutes = Number(row.payload["minutesBefore"]);
      expect(row.payload).toEqual({ meetingId: meeting.id, version: 1, minutesBefore: minutes });
      expect(new Date(row.available_at).getTime()).toBe(start - minutes * 60_000);
    }

    expect((await patch("ceo", `/api/v1/meetings/${meeting.id}`, { startsAtLocal: localDateTimeIn(90) })).statusCode).toBe(200);
    const second = await reminders(meeting.id);
    expect(second).toHaveLength(6);
    expect(second.filter((r) => r.dedupe_key.includes(":v1:")).every((r) => r.status === "pending")).toBe(true);

    expect((await post("ceo", `/api/v1/meetings/${meeting.id}/cancel`)).statusCode).toBe(200);
    expect(await reminders(meeting.id)).toHaveLength(6);
    expect((await post("ceo", `/api/v1/meetings/${meeting.id}/cancel`)).statusCode).toBe(409);

    // About 7 minutes ahead (seconds are dropped): the 10-minute reminder is already past.
    const soon = await create(["alice"], { startsAtLocal: localDateTimeIn(7) });
    expect((await reminders(soon.id)).map((r) => Number(r.payload["minutesBefore"])).sort((a, b) => a - b)).toEqual([2, 5]);
  });

  it("rule 1: a time change resets every current response and stamps responsesResetAt", async () => {
    const meeting = await create(["alice", "bob"]);
    await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" });
    await post("bob", `/api/v1/meetings/${meeting.id}/response`, { response: "declined" });

    const before = Date.now();
    const moved = meetingOf(await patch("ceo", `/api/v1/meetings/${meeting.id}`, { startsAtLocal: localDateTimeIn(120) }));
    const after = Date.now();
    expect(moved.version).toBe(2);
    expect(moved.responsesResetAt).not.toBeNull();
    const resetAt = Date.parse(moved.responsesResetAt ?? "");
    expect(resetAt).toBeGreaterThanOrEqual(before - 1000);
    expect(resetAt).toBeLessThanOrEqual(after + 1000);
    expect(resetAt).toBeGreaterThanOrEqual(Date.parse(moved.createdAt));
    const attendees = (await detail("ceo", meeting.id)).attendees;
    expect(attendees.every((a) => a.response === "pending" && a.respondedAt === null)).toBe(true);

    const audit = await lastAudit(meeting.id, "meeting.updated");
    expect(audit.after).toMatchObject({ timeChanged: true, responsesReset: 2, responsesResetAt: moved.responsesResetAt });

    // A second time change moves it forward; a later detail-only edit leaves it unchanged.
    const movedAgain = meetingOf(await patch("ceo", `/api/v1/meetings/${meeting.id}`, { durationMinutes: 50 }));
    expect(Date.parse(movedAgain.responsesResetAt ?? "")).toBeGreaterThanOrEqual(resetAt);
    const titled = meetingOf(await patch("ceo", `/api/v1/meetings/${meeting.id}`, { title: "Renamed" }));
    expect(titled.responsesResetAt).toBe(movedAgain.responsesResetAt);
  });

  it("rule 2: title, description, location and link edits keep responses; resending the same time is not a change", async () => {
    const meeting = await create(["alice"]);
    await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" });
    const edited = meetingOf(
      await patch("ceo", `/api/v1/meetings/${meeting.id}`, {
        title: "New title",
        description: "New description",
        location: null,
        meetingUrl: "https://example.test/new-call",
      }),
    );
    expect(edited).toMatchObject({ version: 2, responsesResetAt: null, location: null });
    expect((await responsesOf(meeting.id))[id("alice")]).toBe("accepted");
    expect((await lastAudit(meeting.id, "meeting.updated")).after).toMatchObject({
      timeChanged: false,
      responsesReset: 0,
      responsesResetAt: null,
      titleChanged: true,
      descriptionChanged: true,
      locationChanged: true,
      meetingUrlChanged: true,
    });

    const sameTime = meetingOf(await patch("ceo", `/api/v1/meetings/${meeting.id}`, { durationMinutes: 30 }));
    expect(sameTime.responsesResetAt).toBeNull();
    expect((await responsesOf(meeting.id))[id("alice")]).toBe("accepted");
  });

  it("rule 3: replacing attendees keeps retained responses, adds pending, soft-removes, and restores re-added people as pending", async () => {
    const meeting = await create(["alice", "bob"]);
    await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" });
    await post("bob", `/api/v1/meetings/${meeting.id}/response`, { response: "declined" });

    const replaced = meetingOf(await patch("ceo", `/api/v1/meetings/${meeting.id}`, { attendeeIds: [id("alice"), id("cfo")] }));
    expect(replaced.responsesResetAt).toBeNull();
    expect(await responsesOf(meeting.id)).toEqual({ [id("ceo")]: "pending", [id("alice")]: "accepted", [id("cfo")]: "pending" });
    expect((await get("bob", `/api/v1/meetings/${meeting.id}`)).statusCode).toBe(404);
    expect((await lastAudit(meeting.id, "meeting.updated")).after).toMatchObject({
      attendeesAdded: [id("cfo")],
      attendeesRemoved: [id("bob")],
      attendeesRetained: 1,
      timeChanged: false,
    });

    await patch("ceo", `/api/v1/meetings/${meeting.id}`, { attendeeIds: [id("alice"), id("cfo"), id("bob")] });
    expect((await responsesOf(meeting.id))[id("bob")]).toBe("pending");

    // Time and attendees together: removed people are gone and everyone remaining is pending.
    await patch("ceo", `/api/v1/meetings/${meeting.id}`, { attendeeIds: [id("alice")], startsAtLocal: localDateTimeIn(150) });
    expect(await responsesOf(meeting.id)).toEqual({ [id("ceo")]: "pending", [id("alice")]: "pending" });
  });

  it("responses: invitees only, while scheduled and not ended", async () => {
    const meeting = await create(["alice"]);
    const accepted = meetingOf(await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" }));
    expect(accepted.viewerResponse).toBe("accepted");
    expect((await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "maybe" })).statusCode).toBe(400);
    expect((await post("bob", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" })).statusCode).toBe(404);

    const ended = await create(["alice"]);
    await db.query("UPDATE meetings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1", [ended.id]);
    expect((await post("alice", `/api/v1/meetings/${ended.id}/response`, { response: "accepted" })).statusCode).toBe(409);
    expect((await patch("ceo", `/api/v1/meetings/${ended.id}`, { title: "Late" })).statusCode).toBe(409);

    await post("ceo", `/api/v1/meetings/${meeting.id}/cancel`);
    expect((await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "declined" })).statusCode).toBe(409);
    expect((await patch("ceo", `/api/v1/meetings/${meeting.id}`, { title: "Too late" })).statusCode).toBe(409);
  });

  it("summary: exact counts and the next meetings, CEO only", async () => {
    const summary = async () => meetingSummarySchema.parse((await get("ceo", "/api/v1/meetings/summary")).json());
    const before = await summary();
    const upcoming = await create(["alice", "bob"]);
    await post("alice", `/api/v1/meetings/${upcoming.id}/response`, { response: "accepted" });
    await post("bob", `/api/v1/meetings/${upcoming.id}/response`, { response: "declined" });
    const toCancel = await create(["alice"]);
    await post("ceo", `/api/v1/meetings/${toCancel.id}/cancel`);
    const held = await create(["alice"]);
    await db.query("UPDATE meetings SET starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' WHERE id = $1", [held.id]);

    const after = await summary();
    expect(after.counts.upcomingAccepted - before.counts.upcomingAccepted).toBe(1);
    expect(after.counts.upcomingDeclined - before.counts.upcomingDeclined).toBe(1);
    expect(after.counts.upcomingPending - before.counts.upcomingPending).toBe(1); // the CEO's own pending row
    expect(after.counts.cancelledLast7Days - before.counts.cancelledLast7Days).toBe(1);
    expect(after.counts.heldLast30Days - before.counts.heldLast30Days).toBe(1);
    expect(after.next.length).toBeLessThanOrEqual(5);
    expect(after.next.every((m) => m.status === "scheduled" && Date.parse(m.startsAt) > Date.now())).toBe(true);
  });

  it("never records titles, descriptions, locations or links in audit events", async () => {
    const meeting = await create(["alice"]);
    await patch("ceo", `/api/v1/meetings/${meeting.id}`, { title: `${SECRET_TEXT} 2`, location: SECRET_TEXT });
    await post("alice", `/api/v1/meetings/${meeting.id}/response`, { response: "accepted" });
    await post("ceo", `/api/v1/meetings/${meeting.id}/cancel`);
    const events = await db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE entity_type = 'meeting' AND entity_id = $1",
      [meeting.id],
    );
    expect(events.map((e) => e.action).sort()).toEqual(["meeting.cancelled", "meeting.created", "meeting.responded", "meeting.updated"]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(SECRET_TEXT);
    expect(serialized).not.toContain(SECRET_URL);
    expect(serialized).not.toContain("Room 2");
    expect(serialized).not.toContain("Weekly planning");
  });
});
