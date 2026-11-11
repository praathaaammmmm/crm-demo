import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOTSTRAP_CONFIRMATION, bootstrapSuperAdmin } from "../src/modules/organization/index.js";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { SUPER_ADMIN } from "./helpers.js";

const valid = {
  ...SUPER_ADMIN,
  passwordConfirmation: SUPER_ADMIN.password,
  confirmation: BOOTSTRAP_CONFIRMATION,
};

describe("Super Admin bootstrap", () => {
  let db: TestDatabase;

  const counts = async () => {
    const [row] = await db.query<{ users: string; audits: string }>(
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM audit_events) AS audits",
    );
    return { users: Number(row?.users), audits: Number(row?.audits) };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    // H7: db is unset if beforeAll failed before the database was created.
    await (db as TestDatabase | undefined)?.close();
  });

  it.each([
    ["no confirmation", { ...valid, confirmation: "yes" }],
    ["mismatched passwords", { ...valid, passwordConfirmation: "a-different-password" }],
    ["password too short", { ...valid, password: "short", passwordConfirmation: "short" }],
  ])("aborts without writing anything: %s", async (_label, input) => {
    await expect(bootstrapSuperAdmin(db.migrator, input)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await counts()).toEqual({ users: 0, audits: 0 });
  });

  it("refuses to run as crm_app", async () => {
    await expect(bootstrapSuperAdmin(db.app, valid)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await counts()).toEqual({ users: 0, audits: 0 });
  });

  it("creates the Super Admin and its audit event together", async () => {
    const { userId } = await bootstrapSuperAdmin(db.migrator, valid);

    const [user] = await db.query<{
      email: string;
      role: string;
      is_super_admin: boolean;
      must_change_password: boolean;
      reports_to_user_id: string | null;
      argon2id: boolean;
    }>(
      `SELECT email, role, is_super_admin, must_change_password, reports_to_user_id,
              password_hash LIKE '$argon2id$%' AS argon2id
       FROM users WHERE id = $1`,
      [userId],
    );
    expect(user).toEqual({
      email: SUPER_ADMIN.email,
      role: "ceo_cto",
      is_super_admin: true,
      must_change_password: false,
      reports_to_user_id: null,
      argon2id: true,
    });

    const audits = await db.query<{ actor_type: string; actor_user_id: string | null; entity_id: string; after: unknown }>(
      "SELECT actor_type, actor_user_id, entity_id, after FROM audit_events WHERE action = 'system.super_admin_bootstrapped'",
    );
    expect(audits).toEqual([
      { actor_type: "bootstrap", actor_user_id: null, entity_id: userId, after: { role: "ceo_cto", status: "active" } },
    ]);
  });

  it("refuses a second Super Admin and writes nothing", async () => {
    await expect(
      bootstrapSuperAdmin(db.migrator, { ...valid, email: "second@example.test" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await counts()).toEqual({ users: 1, audits: 1 });
  });
});
