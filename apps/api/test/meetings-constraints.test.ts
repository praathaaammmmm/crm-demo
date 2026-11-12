import { MEETING_RESPONSES, MEETING_STATES } from "@crm/contracts/meetings";
import { NOTIFICATION_KINDS } from "@crm/contracts/notifications";
import { meetingResponse, meetingState, notificationKind } from "@crm/database/schema";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: meeting constraints", () => {
  let db: TestDatabase;
  let ceoId = "";
  let userId = "";
  let meetingId = "";
  let projectId = "";
  let otherProjectId = "";
  let taskId = "";

  const run = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));
  const asApp = (statement: SQL) => pgErrorCode(db.app.execute(statement));
  const insertMeeting = (extra: SQL = sql``) =>
    run(sql`INSERT INTO meetings (title, starts_at, ends_at, organizer_id) VALUES ('M', now() + interval '1 hour', now() + interval '2 hours', ${ceoId}) ${extra}`);

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    userId = await createUser(db.migrator, { email: "m@example.test", name: "M", password: "test-m-password", role: "employee" });
    const [project] = await db.query<{ id: string }>("INSERT INTO projects (name, created_by) VALUES ('P', $1) RETURNING id", [ceoId]);
    const [other] = await db.query<{ id: string }>("INSERT INTO projects (name, created_by) VALUES ('Q', $1) RETURNING id", [ceoId]);
    projectId = project?.id ?? "";
    otherProjectId = other?.id ?? "";
    const [task] = await db.query<{ id: string }>(
      "INSERT INTO tasks (project_id, title, due_date, assignee_id, created_by) VALUES ($1, 'T', current_date + 1, $2, $3) RETURNING id",
      [projectId, userId, ceoId],
    );
    taskId = task?.id ?? "";
    const [meeting] = await db.query<{ id: string }>(
      "INSERT INTO meetings (title, starts_at, ends_at, organizer_id) VALUES ('M', now() + interval '1 hour', now() + interval '2 hours', $1) RETURNING id",
      [ceoId],
    );
    meetingId = meeting?.id ?? "";
    await db.query("INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1, $2)", [meetingId, userId]);
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("contract enums match the database enums", () => {
    expect([...MEETING_STATES]).toEqual(meetingState.enumValues);
    expect([...MEETING_RESPONSES]).toEqual(meetingResponse.enumValues);
    expect([...NOTIFICATION_KINDS]).toEqual(notificationKind.enumValues);
  });

  it("meetings: time order, 12-hour limit, https links, cancelled_at, and responses_reset_at after creation", async () => {
    expect(await run(sql`UPDATE meetings SET ends_at = starts_at WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET ends_at = starts_at + interval '13 hours' WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET meeting_url = 'http://example.test/x' WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET status = 'cancelled' WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET version = 0 WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET responses_reset_at = created_at - interval '1 second' WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET responses_reset_at = now() WHERE id = ${meetingId}`)).toBeNull();
  });

  it("only the CEO/CTO organises, and a referenced task must belong to the referenced project", async () => {
    expect(
      await run(sql`INSERT INTO meetings (title, starts_at, ends_at, organizer_id) VALUES ('M', now() + interval '1 hour', now() + interval '2 hours', ${userId})`),
    ).toBe("23503");
    expect(await run(sql`UPDATE meetings SET organizer_is_super_admin = false WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET project_id = ${otherProjectId}, task_id = ${taskId} WHERE id = ${meetingId}`)).toBe("23503");
    expect(await run(sql`UPDATE meetings SET project_id = NULL, task_id = ${taskId} WHERE id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meetings SET project_id = ${projectId}, task_id = ${taskId} WHERE id = ${meetingId}`)).toBeNull();
    expect(await insertMeeting()).toBeNull();
  });

  it("attendee responses: responded_at is set exactly when the response is not pending", async () => {
    expect(await run(sql`UPDATE meeting_attendees SET response = 'accepted' WHERE meeting_id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meeting_attendees SET responded_at = now() WHERE meeting_id = ${meetingId}`)).toBe("23514");
    expect(await run(sql`UPDATE meeting_attendees SET response = 'declined', responded_at = now() WHERE meeting_id = ${meetingId}`)).toBeNull();
  });

  it("notifications: only 10, 5 or 2 minutes, one per event and recipient", async () => {
    const insert = (minutes: number, source: string) =>
      run(sql`INSERT INTO notifications (recipient_id, kind, meeting_id, meeting_version, minutes_before, source_event_id)
              VALUES (${userId}, 'meeting_reminder', ${meetingId}, 1, ${minutes}, ${source}::uuid)`);
    const source = "00000000-0000-7000-8000-0000000000aa";
    expect(await insert(3, source)).toBe("23514");
    expect(await insert(2, source)).toBeNull();
    expect(await insert(2, source)).toBe("23505");
  });

  it("crm_app may insert only well-formed meeting reminder events into the outbox", async () => {
    const insert = (eventType: string, payload: string, key: string) =>
      asApp(sql`INSERT INTO outbox_events (event_type, payload, dedupe_key, available_at) VALUES (${eventType}, ${payload}::jsonb, ${key}, now())`);
    const good = JSON.stringify({ meetingId, version: 1, minutesBefore: 10 });
    expect(await insert("meetings.reminder_due", good, `meeting:${meetingId}:v1:m10`)).toBeNull();
    expect(await insert("system.health_check", "{}", "system.health_check:x")).toBe("23514");
    expect(await insert("meetings.reminder_due", JSON.stringify({ meetingId, version: 1, minutesBefore: 10, extra: 1 }), `meeting:${meetingId}:v1:m5`)).toBe("23514");
    expect(await insert("meetings.reminder_due", JSON.stringify({ meetingId, version: 1, minutesBefore: 3 }), `meeting:${meetingId}:v1:m2`)).toBe("23514");
    expect(await insert("meetings.reminder_due", good, "not-a-meeting-key")).toBe("23514");
  });
});
