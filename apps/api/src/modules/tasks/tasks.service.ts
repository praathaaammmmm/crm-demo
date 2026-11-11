import type {
  CreateTaskRequest,
  ProofRequest,
  ReviewRequest,
  StatusChangeRequest,
  TaskListQuery,
  UpdateTaskRequest,
} from "@crm/contracts/tasks";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Executor, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { checkAssignee } from "../organization/index.js";
import { projectExists } from "../projects/index.js";
import { TASK_AUDIT, taskSnapshot } from "./tasks.audit.js";
import * as policy from "./tasks.policy.js";
import * as repo from "./tasks.repository.js";
import type { TaskProofRow, TaskRow, TaskUpdateRow } from "./tasks.repository.js";
import { canAssigneeMove, canSubmit, isOpen } from "./tasks.transitions.js";

type User = AuthSession["user"];

export interface TaskDeps {
  db: Database;
  /** Defines "today" for due dates and overdue tasks. */
  orgTimezone: string;
}

/** Today's date (YYYY-MM-DD) in the organisation's time zone. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

function assertDueDateNotPast(dueDate: string, timeZone: string): void {
  if (dueDate < todayIn(timeZone)) throw errors.validation("The due date cannot be in the past");
}

async function assertAssignable(db: Executor, userId: string): Promise<void> {
  if ((await checkAssignee(db, userId)) !== "ok") {
    throw errors.validation("The assignee must be an active team member other than the CEO/CTO");
  }
}

/** Locks the task; throws 404 if it does not exist. */
async function lockExisting(tx: Tx, id: string, timeZone: string): Promise<TaskRow> {
  const task = await repo.lockTask(tx, id, timeZone);
  if (!task) throw errors.notFound();
  return task;
}

async function reload(tx: Tx, id: string, timeZone: string): Promise<TaskRow> {
  const task = await repo.findTask(tx, id, timeZone);
  if (!task) throw new Error("Task not found after change");
  return task;
}

const assertOpen = (task: TaskRow) => {
  if (!isOpen(task.status)) throw errors.conflict("A completed task cannot be changed");
};

/** CEO only. The assignee must be an active, non-CEO user; the database enforces the latter too. */
export async function createTask(deps: TaskDeps, ctx: Ctx, user: User, input: CreateTaskRequest): Promise<TaskRow> {
  policy.assertCanCreate(user);
  assertDueDateNotPast(input.dueDate, deps.orgTimezone);
  if (!(await projectExists(deps.db, input.projectId))) throw errors.notFound();
  await assertAssignable(deps.db, input.assigneeId);

  return deps.db.transaction(async (tx) => {
    const id = await repo.insertTask(tx, { ...input, createdBy: user.id });
    const created = await reload(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.created,
      entityType: "task",
      entityId: id,
      after: { ...taskSnapshot(created), projectId: created.projectId },
    });
    return created;
  });
}

/** CEO only: edit fields or reassign. Completed tasks cannot be changed. */
export async function updateTask(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: UpdateTaskRequest,
): Promise<TaskRow> {
  policy.assertCanManage(user);
  if (input.dueDate !== undefined) assertDueDateNotPast(input.dueDate, deps.orgTimezone);
  if (input.assigneeId !== undefined) await assertAssignable(deps.db, input.assigneeId);

  return deps.db.transaction(async (tx) => {
    const before = await lockExisting(tx, id, deps.orgTimezone);
    assertOpen(before);
    await repo.updateTaskFields(tx, id, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    });
    const after = await reload(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.updated,
      entityType: "task",
      entityId: id,
      before: taskSnapshot(before),
      after: {
        ...taskSnapshot(after),
        titleChanged: before.title !== after.title,
        descriptionChanged: before.description !== after.description,
      },
    });
    return after;
  });
}

/** Assignee only: the direct status changes allowed by tasks.transitions.ts. */
export async function changeStatus(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: StatusChangeRequest,
): Promise<TaskRow> {
  return deps.db.transaction(async (tx) => {
    const task = await lockExisting(tx, id, deps.orgTimezone);
    policy.assertAssigneeAction(user, task);
    if (!canAssigneeMove(task.status, input.status)) throw errors.conflict("This status change is not allowed");
    await repo.setStatus(tx, id, input.status);
    await repo.insertUpdate(tx, {
      taskId: id,
      authorId: user.id,
      fromStatus: task.status,
      toStatus: input.status,
      note: input.note ?? null,
    });
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.statusChanged,
      entityType: "task",
      entityId: id,
      before: { status: task.status },
      after: { status: input.status },
    });
    return reload(tx, id, deps.orgTimezone);
  });
}

/** Assignee only, while the task is open. */
export async function addProgressNote(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  note: string,
): Promise<TaskUpdateRow> {
  return deps.db.transaction(async (tx) => {
    const task = await lockExisting(tx, id, deps.orgTimezone);
    policy.assertAssigneeAction(user, task);
    assertOpen(task);
    const updateId = await repo.insertUpdate(tx, { taskId: id, authorId: user.id, fromStatus: null, toStatus: null, note });
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.progressNoted,
      entityType: "task",
      entityId: id,
      after: { updateId },
    });
    const update = await repo.findUpdate(tx, updateId);
    if (!update) throw new Error("Task update not found after insert");
    return update;
  });
}

/** Assignee only, while the task is open. The URL is stored and returned only; it is never fetched. */
export async function addProof(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: ProofRequest,
): Promise<TaskProofRow> {
  return deps.db.transaction(async (tx) => {
    const task = await lockExisting(tx, id, deps.orgTimezone);
    policy.assertAssigneeAction(user, task);
    assertOpen(task);
    const proofId = await repo.insertProof(tx, {
      taskId: id,
      authorId: user.id,
      url: input.url ?? null,
      note: input.note ?? null,
    });
    await recordAudit(tx, ctx, { action: TASK_AUDIT.proofAdded, entityType: "task", entityId: id, after: { proofId } });
    const proof = await repo.findProof(tx, proofId);
    if (!proof) throw new Error("Task proof not found after insert");
    return proof;
  });
}

/** Assignee only: from in_progress or changes_requested, with at least one proof of work. */
export async function submitForReview(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  note: string | undefined,
): Promise<TaskRow> {
  return deps.db.transaction(async (tx) => {
    const task = await lockExisting(tx, id, deps.orgTimezone);
    policy.assertAssigneeAction(user, task);
    if (!canSubmit(task.status)) throw errors.conflict("Only work in progress can be submitted for review");
    if ((await repo.countProofs(tx, id)) === 0) {
      throw errors.conflict("Add at least one proof of work before submitting");
    }
    await repo.setStatus(tx, id, "in_review");
    await repo.insertUpdate(tx, {
      taskId: id,
      authorId: user.id,
      fromStatus: task.status,
      toStatus: "in_review",
      note: note ?? null,
    });
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.submitted,
      entityType: "task",
      entityId: id,
      before: { status: task.status },
      after: { status: "in_review" },
    });
    return reload(tx, id, deps.orgTimezone);
  });
}

/** CEO only, for tasks in review: approve (completed) or request changes (note required). */
export async function reviewTask(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: ReviewRequest,
): Promise<TaskRow> {
  policy.assertCanReview(user);
  return deps.db.transaction(async (tx) => {
    const task = await lockExisting(tx, id, deps.orgTimezone);
    if (task.status !== "in_review") throw errors.conflict("Only tasks in review can be reviewed");
    const status = input.decision === "approved" ? "completed" : "changes_requested";
    await repo.setStatus(tx, id, status);
    await repo.insertReview(tx, { taskId: id, reviewerId: user.id, decision: input.decision, note: input.note ?? null });
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.reviewed,
      entityType: "task",
      entityId: id,
      after: { decision: input.decision, status },
    });
    return reload(tx, id, deps.orgTimezone);
  });
}

/** CEO only: close any open task directly, recorded as a `marked_complete` review. */
export async function markComplete(
  deps: TaskDeps,
  ctx: Ctx,
  user: User,
  id: string,
  note: string | undefined,
): Promise<TaskRow> {
  policy.assertCanReview(user);
  return deps.db.transaction(async (tx) => {
    const task = await lockExisting(tx, id, deps.orgTimezone);
    assertOpen(task);
    await repo.setStatus(tx, id, "completed");
    await repo.insertReview(tx, { taskId: id, reviewerId: user.id, decision: "marked_complete", note: note ?? null });
    await recordAudit(tx, ctx, {
      action: TASK_AUDIT.completed,
      entityType: "task",
      entityId: id,
      before: { status: task.status },
      after: { status: "completed" },
    });
    return reload(tx, id, deps.orgTimezone);
  });
}

/** The CEO sees any task; an assignee sees only their current tasks (others are 404). */
export async function getTaskDetail(deps: TaskDeps, user: User, id: string) {
  const task = await repo.findTask(deps.db, id, deps.orgTimezone);
  if (!task) throw errors.notFound();
  policy.assertCanView(user, task);
  return { task, ...(await repo.history(deps.db, id)) };
}

export async function listTasks(
  deps: TaskDeps,
  user: User,
  query: TaskListQuery,
): Promise<{ items: TaskRow[]; nextCursor: string | null }> {
  const scope = policy.readScope(user);
  const rows = await repo.listTasks(
    deps.db,
    {
      assigneeId: scope === "all" ? null : user.id,
      projectId: query.projectId,
      status: query.status,
      overdue: query.overdue === undefined ? undefined : query.overdue === "true",
      cursor: query.cursor,
      limit: query.limit,
    },
    deps.orgTimezone,
  );
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > query.limit && last ? last.id : null };
}

/** CEO dashboard counts. */
export async function taskSummary(deps: TaskDeps, user: User) {
  policy.assertCanReadAll(user);
  return repo.summary(deps.db, deps.orgTimezone);
}

/** For the projects module (connected in app.ts): projects containing the user's current tasks. */
export function assignedProjectIds(db: Executor, userId: string): Promise<string[]> {
  return repo.projectIdsAssignedTo(db, userId);
}
