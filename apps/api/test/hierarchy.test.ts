import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/modules/identity/index.js";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: direct reporting to the CEO/CTO (ADR 0005)", () => {
  let db: TestDatabase;
  let ceoId: string;
  let employeeId: string;
  let otherId: string;
  let passwordHash: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    passwordHash = await hashPassword("test-hierarchy-password");
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    employeeId = await createUser(db.migrator, {
      email: "employee@example.test",
      name: "Employee",
      password: "test-employee-password",
      role: "employee",
    });
    otherId = await createUser(db.migrator, {
      email: "other@example.test",
      name: "Other",
      password: "test-other-password",
      role: "cfo",
    });
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("forces every new user's reporting line to the CEO, overriding any supplied manager", async () => {
    const result = await db.migrator.execute<{ reports_to_user_id: string; reports_to_is_super_admin: boolean }>(sql`
      INSERT INTO users (email, name, role, password_hash, reports_to_user_id, reports_to_is_super_admin)
      VALUES ('override@example.test', 'Override', 'employee', ${passwordHash}, ${otherId}, true)
      RETURNING reports_to_user_id, reports_to_is_super_admin
    `);
    expect(result.rows[0]).toEqual({ reports_to_user_id: ceoId, reports_to_is_super_admin: true });
  });

  it("rejects a second Super Admin", async () => {
    const code = await pgErrorCode(
      db.migrator.execute(sql`
        INSERT INTO users (email, name, role, is_super_admin, password_hash)
        VALUES ('second-ceo@example.test', 'Second', 'ceo_cto', true, ${passwordHash})
      `),
    );
    expect(code).toBe("23505");
  });

  it("does not allow the CEO's role or status to change", async () => {
    expect(await pgErrorCode(db.migrator.execute(sql`UPDATE users SET role = 'cfo' WHERE id = ${ceoId}`))).toBe("23514");
    expect(
      await pgErrorCode(
        db.migrator.execute(sql`UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = ${ceoId}`),
      ),
    ).toBe("23514");
  });

  it("does not allow a non-CEO role to become ceo_cto", async () => {
    expect(await pgErrorCode(db.migrator.execute(sql`UPDATE users SET role = 'ceo_cto' WHERE id = ${employeeId}`))).toBe(
      "23514",
    );
  });

  it("rejects a half-filled reporting line (MATCH FULL) and a manager other than the CEO", async () => {
    expect(
      await pgErrorCode(db.migrator.execute(sql`UPDATE users SET reports_to_is_super_admin = NULL WHERE id = ${employeeId}`)),
    ).toBe("23503");
    expect(
      await pgErrorCode(db.migrator.execute(sql`UPDATE users SET reports_to_user_id = ${otherId} WHERE id = ${employeeId}`)),
    ).toBe("23503");
  });

  it("gives crm_app no way to set the Super Admin flag or a reporting line", async () => {
    expect(
      await pgErrorCode(
        db.app.execute(sql`
          INSERT INTO users (email, name, role, is_super_admin, password_hash)
          VALUES ('app-ceo@example.test', 'App', 'ceo_cto', true, ${passwordHash})
        `),
      ),
    ).toBe("42501");
    expect(
      await pgErrorCode(db.app.execute(sql`UPDATE users SET reports_to_user_id = ${otherId} WHERE id = ${employeeId}`)),
    ).toBe("42501");
  });
});
