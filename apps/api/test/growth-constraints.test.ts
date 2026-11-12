import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: growth companies and contacts", () => {
  let db: TestDatabase;
  let ceoId = "";
  let cgoId = "";
  let employeeId = "";
  let inactiveCgoId = "";

  const run = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));
  const company = async (name: string, owner = cgoId): Promise<string> => {
    const [row] = await db.query<{ id: string }>(
      "INSERT INTO growth_companies (name, owner_id, created_by) VALUES ($1, $2, $2) RETURNING id",
      [name, owner],
    );
    return row?.id ?? "";
  };
  const contact = async (companyId: string, email = "c@example.test"): Promise<string> => {
    const [row] = await db.query<{ id: string }>(
      "INSERT INTO growth_contacts (company_id, full_name, email, owner_id) VALUES ($1, 'Asha Rao', $2, $3) RETURNING id",
      [companyId, email, cgoId],
    );
    return row?.id ?? "";
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    cgoId = await createUser(db.migrator, { email: "cgo@example.test", name: "CGO", password: "test-cgo-password", role: "cgo" });
    employeeId = await createUser(db.migrator, { email: "e@example.test", name: "E", password: "test-e-password", role: "employee" });
    inactiveCgoId = await createUser(db.migrator, { email: "old@example.test", name: "Old", password: "test-old-password", role: "cgo" });
    await db.query("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = $1", [inactiveCgoId]);
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("owner columns: NOT NULL, never the CEO, never partly null, never a super admin flag", async () => {
    // The owner trigger runs before PostgreSQL evaluates NOT NULL, so a null owner is refused by the trigger.
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('N', NULL, ${cgoId})`)).toBe("23514");
    const notNull = await db.query<{ table: string; not_null: boolean }>(
      `SELECT c.relname AS table, a.attnotnull AS not_null FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname IN ('growth_companies', 'growth_contacts') AND a.attname = 'owner_id' ORDER BY c.relname`,
    );
    expect(notNull).toEqual([
      { table: "growth_companies", not_null: true },
      { table: "growth_contacts", not_null: true },
    ]);
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by, owner_is_super_admin) VALUES ('S', ${cgoId}, ${cgoId}, true)`)).toBe("23514");
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by, owner_is_super_admin) VALUES ('P', ${cgoId}, ${cgoId}, NULL)`)).toBe("23502");
    // The CEO fails the active-CGO trigger first; the foreign key would also refuse it.
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('C', ${ceoId}, ${ceoId})`)).toBe("23514");
    const id = await company("Owner Fk Co");
    expect(await run(sql`UPDATE growth_companies SET owner_is_super_admin = true WHERE id = ${id}`)).toBe("23514");
  });

  it("owner guard: only an active CGO can be assigned; keeping an owner who left is allowed", async () => {
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('E', ${employeeId}, ${cgoId})`)).toBe("23514");
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('I', ${inactiveCgoId}, ${cgoId})`)).toBe("23514");
    const id = await company("Guard Co");
    expect(await run(sql`UPDATE growth_companies SET owner_id = ${employeeId} WHERE id = ${id}`)).toBe("23514");
    const contactId = await contact(id);
    expect(await run(sql`UPDATE growth_contacts SET owner_id = ${employeeId} WHERE id = ${contactId}`)).toBe("23514");

    // A later role change or deactivation of the owner is not blocked, and their records stay editable.
    const leaver = await createUser(db.migrator, { email: "leaver@example.test", name: "Leaver", password: "test-leaver-password", role: "cgo" });
    const owned = await company("Leaver Co", leaver);
    expect(await run(sql`UPDATE users SET role = 'cmo' WHERE id = ${leaver}`)).toBeNull();
    expect(await run(sql`UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = ${leaver}`)).toBeNull();
    expect(await run(sql`UPDATE growth_companies SET notes = 'Kept' WHERE id = ${owned}`)).toBeNull();
  });

  it("names are normalised: whitespace and case cannot bypass uniqueness or length", async () => {
    await company("Acme Inc");
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES (' Acme Inc', ${cgoId}, ${cgoId})`)).toBe("23514");
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('Acme  Inc', ${cgoId}, ${cgoId})`)).toBe("23514");
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('ACME INC', ${cgoId}, ${cgoId})`)).toBe("23505");
    expect(await run(sql`INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('', ${cgoId}, ${cgoId})`)).toBe("23514");
    const id = await company("Industry Co");
    expect(await run(sql`UPDATE growth_companies SET industry = ' Fintech' WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_companies SET industry = ${"x".repeat(101)} WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_companies SET industry = '' WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_companies SET industry = 'Fintech' WHERE id = ${id}`)).toBeNull();
    expect(await run(sql`UPDATE growth_companies SET website_url = 'http://x.test' WHERE id = ${id}`)).toBe("23514");
  });

  it("contacts need a normalised name and at least one contact method; formats are enforced", async () => {
    const id = await company("Contact Rules Co");
    const insert = (name: string, email: string | null, phone: string | null, linkedin: string | null) =>
      run(sql`INSERT INTO growth_contacts (company_id, full_name, email, phone, linkedin_url, owner_id)
              VALUES (${id}, ${name}, ${email}, ${phone}, ${linkedin}, ${cgoId})`);
    expect(await insert("No Method", null, null, null)).toBe("23514");
    expect(await insert(" Padded", "p@example.test", null, null)).toBe("23514");
    expect(await insert("Upper", "UP@example.test", null, null)).toBe("23514");
    expect(await insert("Phone", null, "call me", null)).toBe("23514");
    expect(await insert("Link", null, null, "https://example.test/in/x")).toBe("23514");
    expect(await insert("Ok", null, "+91 98765 43210", null)).toBeNull();
    expect(await insert("Ok Link", null, null, "https://www.linkedin.com/in/x")).toBeNull();
    const c = await contact(id, "dup@example.test");
    expect(c).not.toBe("");
    expect(await insert("Dup", "dup@example.test", null, null)).toBe("23505");
  });

  it("archive guards: archived companies and their contacts are read-only, but readable", async () => {
    const id = await company("Archived Co");
    const contactId = await contact(id);
    expect(await run(sql`UPDATE growth_companies SET archived_at = now() WHERE id = ${id}`)).toBeNull();
    expect(await run(sql`UPDATE growth_companies SET notes = 'x' WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_companies SET archived_at = NULL WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`INSERT INTO growth_contacts (company_id, full_name, email, owner_id) VALUES (${id}, 'Late', 'l@example.test', ${cgoId})`)).toBe("23514");
    expect(await run(sql`UPDATE growth_contacts SET role_title = 'CTO' WHERE id = ${contactId}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_contacts SET do_not_contact = true WHERE id = ${contactId}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_contacts SET archived_at = now() WHERE id = ${contactId}`)).toBe("23514");
    expect((await db.query("SELECT id FROM growth_companies WHERE id = $1", [id])).length).toBe(1);
    expect((await db.app.execute(sql`SELECT id FROM growth_contacts WHERE id = ${contactId}`)).rows.length).toBe(1);

    const live = await company("Live Co");
    const archivedContact = await contact(live, "a@example.test");
    expect(await run(sql`UPDATE growth_contacts SET archived_at = now() WHERE id = ${archivedContact}`)).toBeNull();
    expect(await run(sql`UPDATE growth_contacts SET archived_at = NULL WHERE id = ${archivedContact}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_contacts SET full_name = 'Renamed' WHERE id = ${archivedContact}`)).toBe("23514");
  });

  it("a contact insert waits for a concurrent company archive and is then refused", async () => {
    const id = await company("Race Co");
    let release: () => void = () => undefined;
    let markLocked: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isLocked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const archiver = db.migrator.transaction(async (tx) => {
      await tx.execute(sql`UPDATE growth_companies SET archived_at = now() WHERE id = ${id}`);
      markLocked();
      await held;
    });
    await isLocked;
    const insert = run(sql`INSERT INTO growth_contacts (company_id, full_name, email, owner_id) VALUES (${id}, 'Racer', 'r@example.test', ${cgoId})`);
    release();
    await archiver;
    expect(await insert).toBe("23514");
  });
});
