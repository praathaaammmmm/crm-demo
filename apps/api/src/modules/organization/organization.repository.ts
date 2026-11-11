import { users } from "@crm/database/schema";
import type { AssignableRole } from "@crm/permissions";
import { asc, eq, gt, sql } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

export async function currentDatabaseRole(db: Executor): Promise<string | null> {
  const result = await db.execute<{ role: string }>(sql`SELECT current_user AS role`);
  return result.rows[0]?.role ?? null;
}

export async function superAdminExists(db: Executor): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  return rows.length > 0;
}

/** Runs as crm_migrator only: application roles have no grant on is_super_admin. */
export async function insertSuperAdmin(
  tx: Tx,
  input: { email: string; name: string; passwordHash: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, role, is_super_admin, must_change_password, password_hash)
    VALUES (${input.email}, ${input.name}, 'ceo_cto'::user_role, true, false, ${input.passwordHash})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Super Admin insert returned no row");
  return row.id;
}

/**
 * Explicit column list: crm_app may insert only these columns. There is deliberately no manager
 * column: the database trigger sets the reporting line to the CEO/CTO (ADR 0005).
 */
export async function insertUser(
  tx: Tx,
  input: { email: string; name: string; role: AssignableRole; passwordHash: string; createdBy: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, role, password_hash, must_change_password, created_by)
    VALUES (${input.email}, ${input.name}, ${input.role}::user_role, ${input.passwordHash}, true, ${input.createdBy})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("User insert returned no row");
  return row.id;
}

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  isSuperAdmin: users.isSuperAdmin,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
};

export type UserRecord = NonNullable<Awaited<ReturnType<typeof findUserById>>>;

export async function findUserById(db: Executor, id: string) {
  const rows = await db.select(userColumns).from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks the user row until the transaction ends, so concurrent changes cannot interleave. */
export async function lockUser(tx: Tx, id: string) {
  const rows = await tx.select(userColumns).from(users).where(eq(users.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export async function listDirectory(db: Executor, page: { cursor: string | undefined; limit: number }) {
  return db
    .select({ id: users.id, name: users.name, role: users.role, status: users.status, email: users.email })
    .from(users)
    .where(page.cursor === undefined ? undefined : gt(users.id, page.cursor))
    .orderBy(asc(users.id))
    .limit(page.limit + 1);
}

export async function setRole(tx: Tx, id: string, role: AssignableRole): Promise<void> {
  await tx.update(users).set({ role, updatedAt: sql`now()` }).where(eq(users.id, id));
}

export async function setDeactivated(tx: Tx, id: string): Promise<void> {
  await tx
    .update(users)
    .set({ status: "deactivated", deactivatedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(users.id, id));
}
