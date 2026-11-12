import type { AutomationStatus } from "@crm/contracts/operations";
import { opsAutomationChanges, opsAutomationRuns, opsAutomations } from "@crm/database/schema";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";
import { insertedId } from "./inserted-id.js";

const automationColumns = {
  id: opsAutomations.id,
  name: opsAutomations.name,
  purpose: opsAutomations.purpose,
  triggerDescription: opsAutomations.triggerDescription,
  status: opsAutomations.status,
  // The five most recent outcomes, newest first, for the health rule in the contracts.
  recentOutcomes: sql<string[]>`ARRAY(SELECT r.outcome::text FROM ops_automation_runs r WHERE r.automation_id = ops_automations.id
    ORDER BY r.finished_at DESC, r.id DESC LIMIT 5)`,
  /** ISO-8601 UTC text, so no driver timestamp parsing is involved. */
  lastRunAt: sql<string | null>`(SELECT to_char(max(r.finished_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    FROM ops_automation_runs r WHERE r.automation_id = ops_automations.id)`,
  failuresLast30Days: sql<number>`(SELECT count(*)::int FROM ops_automation_runs r WHERE r.automation_id = ops_automations.id
    AND r.outcome = 'failed' AND r.finished_at >= now() - interval '30 days')`,
  createdBy: opsAutomations.createdBy,
  createdAt: opsAutomations.createdAt,
  updatedAt: opsAutomations.updatedAt,
};

export type AutomationRow = NonNullable<Awaited<ReturnType<typeof findAutomation>>>;
export type RunRow = typeof opsAutomationRuns.$inferSelect;
export type ChangeRow = typeof opsAutomationChanges.$inferSelect;

export async function findAutomation(db: Executor, id: string) {
  const rows = await db.select(automationColumns).from(opsAutomations).where(eq(opsAutomations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockAutomation(tx: Tx, id: string) {
  // FOR UPDATE cannot lock through the aggregate subqueries' tables, only the automation row itself.
  const rows = await tx.select(automationColumns).from(opsAutomations).where(eq(opsAutomations.id, id)).limit(1).for("update", { of: opsAutomations });
  return rows[0] ?? null;
}

export function listAutomations(db: Executor, filter: { status: AutomationStatus | undefined; cursor: string | undefined; limit: number }) {
  const conditions: SQL[] = [];
  if (filter.status !== undefined) conditions.push(eq(opsAutomations.status, filter.status));
  if (filter.cursor !== undefined) conditions.push(sql`${opsAutomations.id} > ${filter.cursor}`);
  return db
    .select(automationColumns)
    .from(opsAutomations)
    .where(and(...conditions))
    .orderBy(asc(opsAutomations.id))
    .limit(filter.limit + 1);
}

export async function insertAutomation(tx: Tx, input: { name: string; purpose: string; triggerDescription: string; createdBy: string }): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO ops_automations (name, purpose, trigger_description, created_by)
    VALUES (${input.name}, ${input.purpose}, ${input.triggerDescription}, ${input.createdBy})
    RETURNING id
  `);
  return insertedId(result.rows, "Automation");
}

export async function updateAutomation(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof opsAutomations.$inferInsert, "name" | "purpose" | "triggerDescription" | "status">>,
): Promise<void> {
  await tx
    .update(opsAutomations)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(opsAutomations.id, id));
}

export async function insertChange(
  tx: Tx,
  input: { automationId: string; fromStatus: AutomationStatus; toStatus: AutomationStatus; note: string | null; actorId: string },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO ops_automation_changes (automation_id, from_status, to_status, note, actor_id)
    VALUES (${input.automationId}, ${input.fromStatus}::ops_automation_status, ${input.toStatus}::ops_automation_status, ${input.note}, ${input.actorId})
  `);
}

export async function insertRun(
  tx: Tx,
  input: { automationId: string; startedAt: Date; finishedAt: Date; outcome: "succeeded" | "failed"; errorSummary: string | null; recordedBy: string },
): Promise<RunRow> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO ops_automation_runs (automation_id, started_at, finished_at, outcome, error_summary, recorded_by)
    VALUES (${input.automationId}, ${input.startedAt.toISOString()}::timestamptz, ${input.finishedAt.toISOString()}::timestamptz,
            ${input.outcome}::ops_run_outcome, ${input.errorSummary}, ${input.recordedBy})
    RETURNING id
  `);
  const rows = await tx.select().from(opsAutomationRuns).where(eq(opsAutomationRuns.id, insertedId(result.rows, "Run"))).limit(1);
  const run = rows[0];
  if (!run) throw new Error("Run not found after insert");
  return run;
}

/** Newest first, at most 50. */
export function recentRuns(db: Executor, automationId: string): Promise<RunRow[]> {
  return db
    .select()
    .from(opsAutomationRuns)
    .where(eq(opsAutomationRuns.automationId, automationId))
    .orderBy(desc(opsAutomationRuns.finishedAt), desc(opsAutomationRuns.id))
    .limit(50);
}

/** Oldest first. */
export function changes(db: Executor, automationId: string): Promise<ChangeRow[]> {
  return db.select().from(opsAutomationChanges).where(eq(opsAutomationChanges.automationId, automationId)).orderBy(asc(opsAutomationChanges.createdAt), asc(opsAutomationChanges.id));
}
