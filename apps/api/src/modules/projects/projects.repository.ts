import { projects } from "@crm/database/schema";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

export type ProjectRow = typeof projects.$inferSelect;

// Explicit column list: crm_app may insert only these columns.
export async function insertProject(
  tx: Tx,
  input: { name: string; description: string; createdBy: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO projects (name, description, created_by)
    VALUES (${input.name}, ${input.description}, ${input.createdBy})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Project insert returned no row");
  return row.id;
}

export async function findProject(db: Executor, id: string): Promise<ProjectRow | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0] ?? null;
}

/** `onlyIds` limits the list to those projects (null = all). */
export async function listProjects(
  db: Executor,
  page: { onlyIds: readonly string[] | null; cursor: string | undefined; limit: number },
): Promise<ProjectRow[]> {
  if (page.onlyIds !== null && page.onlyIds.length === 0) return [];
  const conditions: SQL[] = [];
  if (page.onlyIds !== null) conditions.push(inArray(projects.id, [...page.onlyIds]));
  if (page.cursor !== undefined) conditions.push(gt(projects.id, page.cursor));
  return db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(asc(projects.id))
    .limit(page.limit + 1);
}
