import type { DefectSeverity, DefectStatus, QaOutcome, ReleaseReadiness } from "@crm/contracts/quality";
import { defects, defectUpdates, qaChecks, qaResults, releaseReadinessDecisions, tasks } from "@crm/database/schema";
import { and, asc, desc, eq, gt, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

const FINAL_STATUSES: DefectStatus[] = ["verified", "wont_fix"];

// QA checks are read with their task's project; defects also with the task's current assignee.
// Record-level access always follows the task's current assignee.

const qaCheckColumns = {
  id: qaChecks.id,
  taskId: qaChecks.taskId,
  projectId: tasks.projectId,
  title: qaChecks.title,
  latestOutcome: qaChecks.latestOutcome,
  latestResultAt: qaChecks.latestResultAt,
  createdBy: qaChecks.createdBy,
  createdAt: qaChecks.createdAt,
};

const defectColumns = {
  id: defects.id,
  taskId: defects.taskId,
  projectId: tasks.projectId,
  assigneeId: tasks.assigneeId,
  qaCheckId: defects.qaCheckId,
  title: defects.title,
  severity: defects.severity,
  status: defects.status,
  reproductionSteps: defects.reproductionSteps,
  reportedBy: defects.reportedBy,
  createdAt: defects.createdAt,
  updatedAt: defects.updatedAt,
  resolvedAt: defects.resolvedAt,
};

export type QaCheckRow = NonNullable<Awaited<ReturnType<typeof findQaCheck>>>;
export type QaResultRow = typeof qaResults.$inferSelect;
export type DefectRow = NonNullable<Awaited<ReturnType<typeof findDefect>>>;
export type DefectUpdateRow = typeof defectUpdates.$inferSelect;
export type ReadinessRow = typeof releaseReadinessDecisions.$inferSelect;

async function insertReturningId(tx: Tx, statement: SQL, what: string): Promise<string> {
  const result = await tx.execute<{ id: string }>(statement);
  const row = result.rows[0];
  if (!row) throw new Error(`${what} insert returned no row`);
  return row.id;
}

/** The task a quality item is linked to, or null if it does not exist. */
export async function findTaskRef(db: Executor, taskId: string) {
  const rows = await db
    .select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0] ?? null;
}

// QA checks

export async function findQaCheck(db: Executor, id: string) {
  const rows = await db.select(qaCheckColumns).from(qaChecks).innerJoin(tasks, eq(tasks.id, qaChecks.taskId)).where(eq(qaChecks.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks only the QA check row (not its task) until the transaction ends. */
export async function lockQaCheck(tx: Tx, id: string) {
  const rows = await tx
    .select(qaCheckColumns)
    .from(qaChecks)
    .innerJoin(tasks, eq(tasks.id, qaChecks.taskId))
    .where(eq(qaChecks.id, id))
    .limit(1)
    .for("update", { of: qaChecks });
  return rows[0] ?? null;
}

export async function listQaChecks(
  db: Executor,
  filter: {
    assigneeId: string | null;
    taskId: string | undefined;
    projectId: string | undefined;
    outcome: QaOutcome | undefined;
    cursor: string | undefined;
    limit: number;
  },
) {
  const conditions: SQL[] = [];
  if (filter.assigneeId !== null) conditions.push(eq(tasks.assigneeId, filter.assigneeId));
  if (filter.taskId !== undefined) conditions.push(eq(qaChecks.taskId, filter.taskId));
  if (filter.projectId !== undefined) conditions.push(eq(tasks.projectId, filter.projectId));
  if (filter.outcome !== undefined) conditions.push(eq(qaChecks.latestOutcome, filter.outcome));
  if (filter.cursor !== undefined) conditions.push(gt(qaChecks.id, filter.cursor));
  return db
    .select(qaCheckColumns)
    .from(qaChecks)
    .innerJoin(tasks, eq(tasks.id, qaChecks.taskId))
    .where(and(...conditions))
    .orderBy(asc(qaChecks.id))
    .limit(filter.limit + 1);
}

// Explicit column lists below: crm_app may insert only these columns.

export function insertQaCheck(tx: Tx, input: { taskId: string; title: string; createdBy: string }): Promise<string> {
  return insertReturningId(
    tx,
    sql`INSERT INTO qa_checks (task_id, title, created_by) VALUES (${input.taskId}, ${input.title}, ${input.createdBy}) RETURNING id`,
    "QA check",
  );
}

export function insertQaResult(
  tx: Tx,
  input: { qaCheckId: string; outcome: QaOutcome; note: string | null; evidenceUrl: string | null; recordedBy: string },
): Promise<string> {
  return insertReturningId(
    tx,
    sql`
      INSERT INTO qa_results (qa_check_id, outcome, note, evidence_url, recorded_by)
      VALUES (${input.qaCheckId}, ${input.outcome}::qa_outcome, ${input.note}, ${input.evidenceUrl}, ${input.recordedBy})
      RETURNING id
    `,
    "QA result",
  );
}

/** Mirrors the newest result onto the check, in the same transaction as the result insert. */
export async function setLatestOutcome(tx: Tx, id: string, outcome: QaOutcome): Promise<void> {
  await tx.update(qaChecks).set({ latestOutcome: outcome, latestResultAt: sql`now()` }).where(eq(qaChecks.id, id));
}

export async function findQaResult(db: Executor, id: string): Promise<QaResultRow | null> {
  const rows = await db.select().from(qaResults).where(eq(qaResults.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Oldest first. */
export function qaResultsFor(db: Executor, qaCheckId: string): Promise<QaResultRow[]> {
  return db.select().from(qaResults).where(eq(qaResults.qaCheckId, qaCheckId)).orderBy(asc(qaResults.recordedAt), asc(qaResults.id));
}

// Defects

export async function findDefect(db: Executor, id: string) {
  const rows = await db.select(defectColumns).from(defects).innerJoin(tasks, eq(tasks.id, defects.taskId)).where(eq(defects.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks only the defect row (not its task) until the transaction ends. */
export async function lockDefect(tx: Tx, id: string) {
  const rows = await tx
    .select(defectColumns)
    .from(defects)
    .innerJoin(tasks, eq(tasks.id, defects.taskId))
    .where(eq(defects.id, id))
    .limit(1)
    .for("update", { of: defects });
  return rows[0] ?? null;
}

export async function listDefects(
  db: Executor,
  filter: {
    assigneeId: string | null;
    taskId: string | undefined;
    projectId: string | undefined;
    status: DefectStatus | undefined;
    severity: DefectSeverity | undefined;
    open: boolean | undefined;
    cursor: string | undefined;
    limit: number;
  },
) {
  const conditions: SQL[] = [];
  if (filter.assigneeId !== null) conditions.push(eq(tasks.assigneeId, filter.assigneeId));
  if (filter.taskId !== undefined) conditions.push(eq(defects.taskId, filter.taskId));
  if (filter.projectId !== undefined) conditions.push(eq(tasks.projectId, filter.projectId));
  if (filter.status !== undefined) conditions.push(eq(defects.status, filter.status));
  if (filter.severity !== undefined) conditions.push(eq(defects.severity, filter.severity));
  if (filter.open === true) conditions.push(notInArray(defects.status, FINAL_STATUSES));
  if (filter.open === false) conditions.push(inArray(defects.status, FINAL_STATUSES));
  if (filter.cursor !== undefined) conditions.push(gt(defects.id, filter.cursor));
  return db
    .select(defectColumns)
    .from(defects)
    .innerJoin(tasks, eq(tasks.id, defects.taskId))
    .where(and(...conditions))
    .orderBy(asc(defects.id))
    .limit(filter.limit + 1);
}

export function insertDefect(
  tx: Tx,
  input: {
    taskId: string;
    qaCheckId: string | null;
    title: string;
    severity: DefectSeverity;
    reproductionSteps: string;
    reportedBy: string;
  },
): Promise<string> {
  return insertReturningId(
    tx,
    sql`
      INSERT INTO defects (task_id, qa_check_id, title, severity, reproduction_steps, reported_by)
      VALUES (${input.taskId}, ${input.qaCheckId}, ${input.title}, ${input.severity}::defect_severity,
              ${input.reproductionSteps}, ${input.reportedBy})
      RETURNING id
    `,
    "Defect",
  );
}

export async function updateDefectFields(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof defects.$inferInsert, "title" | "severity" | "reproductionSteps">>,
): Promise<void> {
  await tx
    .update(defects)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(defects.id, id));
}

/** resolved_at is set exactly when the status becomes final (enforced by a database check). */
export async function setDefectStatus(tx: Tx, id: string, status: DefectStatus): Promise<void> {
  await tx
    .update(defects)
    .set({ status, resolvedAt: FINAL_STATUSES.includes(status) ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(defects.id, id));
}

export function insertDefectUpdate(
  tx: Tx,
  input: {
    defectId: string;
    authorId: string;
    note: string | null;
    evidenceUrl: string | null;
    fromStatus: DefectStatus | null;
    toStatus: DefectStatus | null;
  },
): Promise<string> {
  return insertReturningId(
    tx,
    sql`
      INSERT INTO defect_updates (defect_id, author_id, note, evidence_url, from_status, to_status)
      VALUES (${input.defectId}, ${input.authorId}, ${input.note}, ${input.evidenceUrl},
              ${input.fromStatus}::defect_status, ${input.toStatus}::defect_status)
      RETURNING id
    `,
    "Defect update",
  );
}

export async function findDefectUpdate(db: Executor, id: string): Promise<DefectUpdateRow | null> {
  const rows = await db.select().from(defectUpdates).where(eq(defectUpdates.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Oldest first. */
export function defectUpdatesFor(db: Executor, defectId: string): Promise<DefectUpdateRow[]> {
  return db
    .select()
    .from(defectUpdates)
    .where(eq(defectUpdates.defectId, defectId))
    .orderBy(asc(defectUpdates.createdAt), asc(defectUpdates.id));
}

// Release readiness

export function insertReadiness(
  tx: Tx,
  input: { projectId: string; label: string; readiness: ReleaseReadiness; note: string | null; decidedBy: string },
): Promise<string> {
  return insertReturningId(
    tx,
    sql`
      INSERT INTO release_readiness (project_id, label, readiness, note, decided_by)
      VALUES (${input.projectId}, ${input.label}, ${input.readiness}::release_readiness_status, ${input.note}, ${input.decidedBy})
      RETURNING id
    `,
    "Readiness decision",
  );
}

export async function findReadiness(db: Executor, id: string): Promise<ReadinessRow | null> {
  const rows = await db.select().from(releaseReadinessDecisions).where(eq(releaseReadinessDecisions.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Newest first, ordered by (decided_at, id): the same order that defines the current decision. */
export function listReadiness(db: Executor, projectId: string, cursor: string | undefined, limit: number) {
  const conditions: SQL[] = [eq(releaseReadinessDecisions.projectId, projectId)];
  if (cursor !== undefined) {
    conditions.push(
      sql`(${releaseReadinessDecisions.decidedAt}, ${releaseReadinessDecisions.id}) <
          (SELECT decided_at, id FROM release_readiness WHERE id = ${cursor})`,
    );
  }
  return db
    .select()
    .from(releaseReadinessDecisions)
    .where(and(...conditions))
    .orderBy(desc(releaseReadinessDecisions.decidedAt), desc(releaseReadinessDecisions.id))
    .limit(limit + 1);
}

/** True when any task in the project is currently assigned to the user (self-QA conflict). */
export async function projectHasTaskAssignedTo(db: Executor, projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** Open critical/high defects and failed/blocked QA checks on one project's tasks. */
export async function projectBlockers(db: Executor, projectId: string): Promise<{ defects: number; qaChecks: number }> {
  const result = await db.execute<{ defects: number; qa_checks: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM defects d JOIN tasks t ON t.id = d.task_id
        WHERE t.project_id = ${projectId} AND d.severity IN ('critical', 'high')
          AND d.status NOT IN ('verified', 'wont_fix')) AS defects,
      (SELECT count(*)::int FROM qa_checks q JOIN tasks t ON t.id = q.task_id
        WHERE t.project_id = ${projectId} AND q.latest_outcome IN ('failed', 'blocked')) AS qa_checks
  `);
  const row = result.rows[0];
  return { defects: row?.defects ?? 0, qaChecks: row?.qa_checks ?? 0 };
}

// Summary

/** The current decision per project: the newest by (decided_at, id). */
const LATEST_READINESS = sql`
  SELECT DISTINCT ON (project_id) project_id, readiness, label, decided_at
  FROM release_readiness
  ORDER BY project_id, decided_at DESC, id DESC
`;

/** Exact counts over every project, defect and QA check. Never limited. */
export async function summaryCounts(db: Executor) {
  const result = await db.execute<{
    open_critical: number;
    open_high: number;
    failed: number;
    blocked: number;
    not_ready: number;
    at_risk: number;
  }>(sql`
    WITH latest AS (${LATEST_READINESS})
    SELECT
      (SELECT count(*)::int FROM defects WHERE severity = 'critical' AND status NOT IN ('verified', 'wont_fix')) AS open_critical,
      (SELECT count(*)::int FROM defects WHERE severity = 'high' AND status NOT IN ('verified', 'wont_fix')) AS open_high,
      (SELECT count(*)::int FROM qa_checks WHERE latest_outcome = 'failed') AS failed,
      (SELECT count(*)::int FROM qa_checks WHERE latest_outcome = 'blocked') AS blocked,
      (SELECT count(*) FILTER (WHERE COALESCE(l.readiness, 'not_ready') = 'not_ready')::int
         FROM projects p LEFT JOIN latest l ON l.project_id = p.id) AS not_ready,
      (SELECT count(*) FILTER (WHERE l.readiness = 'at_risk')::int
         FROM projects p LEFT JOIN latest l ON l.project_id = p.id) AS at_risk
  `);
  const row = result.rows[0];
  return {
    openCriticalDefects: row?.open_critical ?? 0,
    openHighDefects: row?.open_high ?? 0,
    failedQaChecks: row?.failed ?? 0,
    blockedQaChecks: row?.blocked ?? 0,
    projectsNotReady: row?.not_ready ?? 0,
    projectsAtRisk: row?.at_risk ?? 0,
  };
}

export interface ProjectBlockerRow {
  projectId: string;
  name: string;
  readiness: ReleaseReadiness;
  label: string | null;
  decidedAt: string | null;
  openCriticalDefects: number;
  openHighDefects: number;
  failedQaChecks: number;
  blockedQaChecks: number;
}

/**
 * Projects that are not ready (no record counts as not_ready) or have any blocker, in a fixed order:
 * not_ready, at_risk, ready; then more blockers first; then name and id. Returns up to `limit` rows.
 */
export async function projectBlockerRows(db: Executor, limit: number): Promise<ProjectBlockerRow[]> {
  const result = await db.execute<{
    project_id: string;
    name: string;
    readiness: ReleaseReadiness;
    label: string | null;
    decided_at: string | null;
    open_critical: number;
    open_high: number;
    failed: number;
    blocked: number;
  }>(sql`
    WITH latest AS (${LATEST_READINESS}),
    d AS (
      SELECT t.project_id,
             count(*) FILTER (WHERE d.severity = 'critical')::int AS open_critical,
             count(*) FILTER (WHERE d.severity = 'high')::int AS open_high
      FROM defects d JOIN tasks t ON t.id = d.task_id
      WHERE d.severity IN ('critical', 'high') AND d.status NOT IN ('verified', 'wont_fix')
      GROUP BY t.project_id
    ),
    q AS (
      SELECT t.project_id,
             count(*) FILTER (WHERE q.latest_outcome = 'failed')::int AS failed,
             count(*) FILTER (WHERE q.latest_outcome = 'blocked')::int AS blocked
      FROM qa_checks q JOIN tasks t ON t.id = q.task_id
      WHERE q.latest_outcome IN ('failed', 'blocked')
      GROUP BY t.project_id
    ),
    candidates AS (
      SELECT p.id AS project_id, p.name,
             COALESCE(l.readiness, 'not_ready') AS readiness,
             l.label,
             to_char(l.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at,
             COALESCE(d.open_critical, 0) AS open_critical,
             COALESCE(d.open_high, 0) AS open_high,
             COALESCE(q.failed, 0) AS failed,
             COALESCE(q.blocked, 0) AS blocked
      FROM projects p
      LEFT JOIN latest l ON l.project_id = p.id
      LEFT JOIN d ON d.project_id = p.id
      LEFT JOIN q ON q.project_id = p.id
    )
    SELECT * FROM candidates
    WHERE readiness <> 'ready' OR open_critical + open_high + failed + blocked > 0
    ORDER BY CASE readiness WHEN 'not_ready' THEN 0 WHEN 'at_risk' THEN 1 ELSE 2 END,
             open_critical + open_high + failed + blocked DESC,
             name, project_id
    LIMIT ${limit}
  `);
  return result.rows.map((row) => ({
    projectId: row.project_id,
    name: row.name,
    readiness: row.readiness,
    label: row.label,
    decidedAt: row.decided_at,
    openCriticalDefects: row.open_critical,
    openHighDefects: row.open_high,
    failedQaChecks: row.failed,
    blockedQaChecks: row.blocked,
  }));
}
