import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, pgErrorCode } from "./helpers.js";

const CHANGES: [string, SQL][] = [
  ["UPDATE", sql`UPDATE audit_events SET action = 'tampered.event'`],
  ["DELETE", sql`DELETE FROM audit_events`],
  ["TRUNCATE", sql`TRUNCATE audit_events`],
];

describe("database: audit events are append-only", () => {
  let db: TestDatabase;
  let snapshot: () => Promise<unknown>;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator); // writes one audit event
    snapshot = () => db.query("SELECT json_agg(a ORDER BY a.id) AS rows FROM audit_events a");
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it.each(CHANGES)("%s is refused for crm_app (grants) and for the owner crm_migrator (trigger)", async (_op, change) => {
    const before = await snapshot();
    expect(await pgErrorCode(db.app.execute(change))).toBe("42501");
    expect(await pgErrorCode(db.migrator.execute(change))).toBe("42501");
    expect(await snapshot()).toEqual(before);
  });

  it("still contains the bootstrap event", async () => {
    const rows = await db.query<{ action: string }>("SELECT action FROM audit_events");
    expect(rows).toEqual([{ action: "system.super_admin_bootstrapped" }]);
  });
});
