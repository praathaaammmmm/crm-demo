import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { createSuperAdmin, createUser } from "../../../test/helpers.js";
import { sessionExpirySweepHandler } from "./session-sweep.js";

describe("session expiry sweep (as crm_worker)", () => {
  let db: TestDatabase;
  let userId = "";

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    userId = await createUser(db.migrator, { email: "sweep@example.test", name: "Sweep", password: "test-sweep-password", role: "employee" });
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  const run = () =>
    db.worker.transaction((tx) =>
      sessionExpirySweepHandler(tx, { id: "x", eventType: "identity.session_expiry_sweep", payload: {}, attempts: 1, maxAttempts: 5 }),
    );

  it("ends expired sessions at their expiry time and records attendance once; active sessions are untouched", async () => {
    // Test-only sessions, inserted as crm_migrator: one created 13 hours ago (expired), one now (active).
    const [expired] = await db.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, created_at, expires_at)
       VALUES ($1, sha256(gen_random_uuid()::text::bytea), now() - interval '13 hours', now() - interval '1 hour') RETURNING id`,
      [userId],
    );
    const [active] = await db.query<{ id: string }>(
      "INSERT INTO sessions (user_id, token_hash) VALUES ($1, sha256(gen_random_uuid()::text::bytea)) RETURNING id",
      [userId],
    );

    expect(await run()).toBe("done");
    expect(await run()).toBe("done");

    const sessions = await db.query<{ id: string; at_expiry: boolean | null; end_reason: string | null }>(
      "SELECT id, ended_at = expires_at AS at_expiry, end_reason FROM sessions WHERE id = ANY($1::uuid[])",
      [[expired?.id, active?.id]],
    );
    expect(sessions.find((s) => s.id === expired?.id)).toMatchObject({ at_expiry: true, end_reason: "expired" });
    expect(sessions.find((s) => s.id === active?.id)).toMatchObject({ at_expiry: null, end_reason: null });

    const attendance = await db.query<{ n: number; at_expiry: boolean }>(
      `SELECT count(*)::int AS n, bool_and(a.occurred_at = s.expires_at) AS at_expiry
       FROM attendance_events a JOIN sessions s ON s.id = a.session_id
       WHERE a.session_id = $1 AND a.kind = 'session_end'`,
      [expired?.id],
    );
    expect(attendance[0]).toMatchObject({ n: 1, at_expiry: true });
  });
});
