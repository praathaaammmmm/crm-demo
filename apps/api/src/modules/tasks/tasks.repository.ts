import type { TaskStatus } from "@crm/contracts/tasks";
import { taskProofs, taskReviews, tasks, taskUpdates } from "@crm/database/schema";
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

/** "Today" in the organisation's time zone, computed by the database. */
const today = (timeZone: string) => sql`(now() AT TIME ZONE ${timeZone})::date`;
const overdueExpression = (timeZone: string) =>
  sql<boolean>`(${tasks.dueDate} < ${today(timeZone)} AND ${tasks.status} <> 'completed')`;

const taskColumns = (timeZone: string) => ({
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  description: tasks.description,
  priority: tasks.priority,
  status: tasks.status,
  dueDate: tasks.dueDate,
  assigneeId: tasks.assigneeId,
  createdBy: tasks.createdBy,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  completedAt: tasks.completedAt,
  overdue: overdueExpression(timeZone),
});

export type TaskRow = NonNullable<Awaited<ReturnType<typeof findTask>>>;
export type TaskUpdateRow = typeof taskUpdates.$inferSelect;
export type TaskProofRow = typeof taskProofs.$inferSelect;
export type TaskReviewRow = typeof taskReviews.$inferSelect;

export async function findTask(db: Executor, id: string, timeZone: string) {
  const rows = await db.select(taskColumns(timeZone)).from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks the task row until the transaction ends, so concurrent changes cannot interleave. */
export async function lockTask(tx: Tx, id: string, timeZone: string) {
  const rows = await tx.select(taskColumns(timeZone)).from(tasks).where(eq(tasks.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export async function listTasks(
  db: Executor,
  filter: {
    assigneeId: string | null;
    projectId: string | undefined;
    status: TaskStatus | undefined;
    overdue: boolean | undefined;
    cursor: string | undefined;
    limit: number;
  },
  timeZone: string,
) {
  const conditions: SQL[] = [];
  if (filter.assigneeId !== null) conditions.push(eq(tasks.assigneeId, filter.assigneeId));
  if (filter.projectId !== undefined) conditions.push(eq(tasks.projectId, filter.projectId));
  if (filter.status !== undefined) conditions.push(eq(tasks.status, filter.status));
  if (filter.overdue === true) conditions.push(overdueExpression(timeZone));
  if (filter.overdue === false) conditions.push(sql`NOT ${overdueExpression(timeZone)}`);
  if (filter.cursor !== undefined) conditions.push(gt(tasks.id, filter.cursor));
  return db
    .select(taskColumns(timeZone))
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.id))
    .limit(filter.limit + 1);
}

// Explicit column lists below: crm_app may insert only these columns.

export async function insertTask(
  tx: Tx,
  input: {
    projectId: string;
    title: string;
    description: string;
    priority: string;
    dueDate: string;
    assigneeId: string;
    createdBy: string;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO tasks (project_id, title, description, priority, due_date, assignee_id, created_by)
    VALUES (${input.projectId}, ${input.title}, ${input.description}, ${input.priority}::task_priority,
            ${input.dueDate}::date, ${input.assigneeId}, ${input.createdBy})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Task insert returned no row");
  return row.id;
}

export async function updateTaskFields(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof tasks.$inferInsert, "title" | "description" | "priority" | "dueDate" | "assigneeId">>,
): Promise<void> {
  await tx
    .update(tasks)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(tasks.id, id));
}

/** completed_at is set exactly when the status becomes completed (enforced by a database check). */
export async function setStatus(tx: Tx, id: string, status: TaskStatus): Promise<void> {
  await tx
    .update(tasks)
    .set({ status, completedAt: status === "completed" ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(tasks.id, id));
}

export async function insertUpdate(
  tx: Tx,
  input: { taskId: string; authorId: string; fromStatus: TaskStatus | null; toStatus: TaskStatus | null; note: string | null },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO task_updates (task_id, author_id, from_status, to_status, note)
    VALUES (${input.taskId}, ${input.authorId}, ${input.fromStatus}::task_status, ${input.toStatus}::task_status,
            ${input.note})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Task update insert returned no row");
  return row.id;
}

export async function insertProof(
  tx: Tx,
  input: { taskId: string; authorId: string; url: string | null; note: string | null },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO task_proofs (task_id, author_id, url, note)
    VALUES (${input.taskId}, ${input.authorId}, ${input.url}, ${input.note})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Task proof insert returned no row");
  return row.id;
}

export async function insertReview(
  tx: Tx,
  input: { taskId: string; reviewerId: string; decision: string; note: string | null },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO task_reviews (task_id, reviewer_id, decision, note)
    VALUES (${input.taskId}, ${input.reviewerId}, ${input.decision}::task_review_decision, ${input.note})
  `);
}

export async function countProofs(tx: Tx, taskId: string): Promise<number> {
  const result = await tx.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM task_proofs WHERE task_id = ${taskId}`,
  );
  return result.rows[0]?.count ?? 0;
}

export async function findUpdate(db: Executor, id: string): Promise<TaskUpdateRow | null> {
  const rows = await db.select().from(taskUpdates).where(eq(taskUpdates.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findProof(db: Executor, id: string): Promise<TaskProofRow | null> {
  const rows = await db.select().from(taskProofs).where(eq(taskProofs.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Full history, oldest first. */
export async function history(db: Executor, taskId: string) {
  const [updates, proofs, reviews] = await Promise.all([
    db.select().from(taskUpdates).where(eq(taskUpdates.taskId, taskId)).orderBy(asc(taskUpdates.createdAt), asc(taskUpdates.id)),
    db.select().from(taskProofs).where(eq(taskProofs.taskId, taskId)).orderBy(asc(taskProofs.createdAt), asc(taskProofs.id)),
    db.select().from(taskReviews).where(eq(taskReviews.taskId, taskId)).orderBy(asc(taskReviews.createdAt), asc(taskReviews.id)),
  ]);
  return { updates, proofs, reviews };
}

export async function projectIdsAssignedTo(db: Executor, userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.assigneeId, userId));
  return rows.map((row) => row.projectId);
}

/** Exact counts for the CEO dashboard, in one query. */
export async function summary(
  db: Executor,
  timeZone: string,
): Promise<{ overdue: number; blocked: number; pendingReview: number; completed: number }> {
  const result = await db.execute<{ overdue: number; blocked: number; pending_review: number; completed: number }>(sql`
    SELECT
      count(*) FILTER (WHERE due_date < ${today(timeZone)} AND status <> 'completed')::int AS overdue,
      count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
      count(*) FILTER (WHERE status = 'in_review')::int AS pending_review,
      count(*) FILTER (WHERE status = 'completed')::int AS completed
    FROM tasks
  `);
  const row = result.rows[0];
  return {
    overdue: row?.overdue ?? 0,
    blocked: row?.blocked ?? 0,
    pendingReview: row?.pending_review ?? 0,
    completed: row?.completed ?? 0,
  };
}
