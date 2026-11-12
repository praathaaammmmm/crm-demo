import type { ReleaseEnvironment, ReleaseStatus } from "@crm/contracts/operations";
import { opsReleaseChecklistItems, opsReleaseDecisions, opsReleases } from "@crm/database/schema";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";
import { insertedId } from "./inserted-id.js";

const releaseColumns = {
  id: opsReleases.id,
  name: opsReleases.name,
  versionLabel: opsReleases.versionLabel,
  environment: opsReleases.environment,
  status: opsReleases.status,
  plannedFor: opsReleases.plannedFor,
  notes: opsReleases.notes,
  // Outer columns are table-qualified so the correlated subqueries cannot bind them to the inner table.
  checklistTotal: sql<number>`(SELECT count(*)::int FROM ops_release_checklist_items i WHERE i.release_id = ops_releases.id)`,
  checklistDone: sql<number>`(SELECT count(*)::int FROM ops_release_checklist_items i WHERE i.release_id = ops_releases.id AND i.done)`,
  createdBy: opsReleases.createdBy,
  createdAt: opsReleases.createdAt,
  updatedAt: opsReleases.updatedAt,
};

export type ReleaseRow = NonNullable<Awaited<ReturnType<typeof findRelease>>>;
export type ChecklistRow = typeof opsReleaseChecklistItems.$inferSelect;
export type DecisionRow = typeof opsReleaseDecisions.$inferSelect;

export async function findRelease(db: Executor, id: string) {
  const rows = await db.select(releaseColumns).from(opsReleases).where(eq(opsReleases.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockRelease(tx: Tx, id: string) {
  const rows = await tx.select(releaseColumns).from(opsReleases).where(eq(opsReleases.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export function listReleases(
  db: Executor,
  filter: { status: ReleaseStatus | undefined; environment: ReleaseEnvironment | undefined; cursor: string | undefined; limit: number },
) {
  const conditions: SQL[] = [];
  if (filter.status !== undefined) conditions.push(eq(opsReleases.status, filter.status));
  if (filter.environment !== undefined) conditions.push(eq(opsReleases.environment, filter.environment));
  if (filter.cursor !== undefined) conditions.push(sql`${opsReleases.id} > ${filter.cursor}`);
  return db
    .select(releaseColumns)
    .from(opsReleases)
    .where(and(...conditions))
    .orderBy(asc(opsReleases.id))
    .limit(filter.limit + 1);
}

export async function insertRelease(
  tx: Tx,
  input: { name: string; versionLabel: string; environment: ReleaseEnvironment; plannedFor: string | null; notes: string | null; createdBy: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO ops_releases (name, version_label, environment, planned_for, notes, created_by)
    VALUES (${input.name}, ${input.versionLabel}, ${input.environment}::ops_release_environment, ${input.plannedFor}::date, ${input.notes}, ${input.createdBy})
    RETURNING id
  `);
  return insertedId(result.rows, "Release");
}

export async function updateRelease(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof opsReleases.$inferInsert, "name" | "versionLabel" | "plannedFor" | "notes" | "status">>,
): Promise<void> {
  await tx
    .update(opsReleases)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(opsReleases.id, id));
}

export function checklist(db: Executor, releaseId: string): Promise<ChecklistRow[]> {
  return db
    .select()
    .from(opsReleaseChecklistItems)
    .where(eq(opsReleaseChecklistItems.releaseId, releaseId))
    .orderBy(asc(opsReleaseChecklistItems.createdAt), asc(opsReleaseChecklistItems.id));
}

export async function findChecklistItem(db: Executor, id: string): Promise<ChecklistRow | null> {
  const rows = await db.select().from(opsReleaseChecklistItems).where(eq(opsReleaseChecklistItems.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertChecklistItem(tx: Tx, input: { releaseId: string; label: string; createdBy: string }): Promise<ChecklistRow> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO ops_release_checklist_items (release_id, label, created_by)
    VALUES (${input.releaseId}, ${input.label}, ${input.createdBy})
    RETURNING id
  `);
  const item = await findChecklistItem(tx, insertedId(result.rows, "Checklist item"));
  if (!item) throw new Error("Checklist item not found after insert");
  return item;
}

export async function setChecklistItem(tx: Tx, id: string, done: boolean, userId: string): Promise<ChecklistRow> {
  const [row] = await tx
    .update(opsReleaseChecklistItems)
    .set(done ? { done: true, doneBy: userId, doneAt: sql`now()` } : { done: false, doneBy: null, doneAt: null })
    .where(eq(opsReleaseChecklistItems.id, id))
    .returning();
  if (!row) throw new Error("Checklist update returned no row");
  return row;
}

export async function insertDecision(
  tx: Tx,
  input: { releaseId: string; fromStatus: ReleaseStatus; toStatus: ReleaseStatus; note: string | null; actorId: string },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO ops_release_decisions (release_id, from_status, to_status, note, actor_id)
    VALUES (${input.releaseId}, ${input.fromStatus}::ops_release_status, ${input.toStatus}::ops_release_status, ${input.note}, ${input.actorId})
  `);
}

/** Oldest first. */
export function decisions(db: Executor, releaseId: string): Promise<DecisionRow[]> {
  return db.select().from(opsReleaseDecisions).where(eq(opsReleaseDecisions.releaseId, releaseId)).orderBy(asc(opsReleaseDecisions.createdAt), asc(opsReleaseDecisions.id));
}
