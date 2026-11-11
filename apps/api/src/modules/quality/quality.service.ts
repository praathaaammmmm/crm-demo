import {
  defectMoveNeedsNote,
  isFinalDefect,
  QUALITY_PROJECT_ROW_CAP,
  type CreateDefectRequest,
  type CreateQaCheckRequest,
  type DefectListQuery,
  type DefectResponseRequest,
  type DefectStatusRequest,
  type QaCheckListQuery,
  type RecordQaResultRequest,
  type SetReadinessRequest,
  type UpdateDefectRequest,
} from "@crm/contracts/quality";
import type { PaginationQuery } from "@crm/contracts/common";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { projectExists } from "../projects/index.js";
import { linkContext, QUALITY_AUDIT } from "./quality.audit.js";
import * as policy from "./quality.policy.js";
import * as repo from "./quality.repository.js";
import type { DefectRow, DefectUpdateRow, QaCheckRow, QaResultRow, ReadinessRow } from "./quality.repository.js";

type User = AuthSession["user"];

export interface QualityDeps {
  db: Database;
}

function page<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}

async function requireTask(deps: QualityDeps, taskId: string) {
  const task = await repo.findTaskRef(deps.db, taskId);
  if (!task) throw errors.notFound();
  return task;
}

async function reloadQaCheck(tx: Tx, id: string): Promise<QaCheckRow> {
  const row = await repo.findQaCheck(tx, id);
  if (!row) throw new Error("QA check not found after change");
  return row;
}

async function reloadDefect(tx: Tx, id: string): Promise<DefectRow> {
  const row = await repo.findDefect(tx, id);
  if (!row) throw new Error("Defect not found after change");
  return row;
}

async function lockExistingDefect(tx: Tx, id: string): Promise<DefectRow> {
  const defect = await repo.lockDefect(tx, id);
  if (!defect) throw errors.notFound();
  return defect;
}

const assertNotFinal = (defect: DefectRow) => {
  if (isFinalDefect(defect.status)) throw errors.conflict("A verified or won't-fix defect cannot be changed");
};

// QA checks

export async function createQaCheck(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  taskId: string,
  input: CreateQaCheckRequest,
): Promise<QaCheckRow> {
  policy.assertCanManage(user);
  const task = await requireTask(deps, taskId);
  policy.assertCanManageFor(user, task);
  return deps.db.transaction(async (tx) => {
    const id = await repo.insertQaCheck(tx, { taskId, title: input.title, createdBy: user.id });
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.qaCheckCreated,
      entityType: "qa_check",
      entityId: id,
      after: linkContext({ taskId, projectId: task.projectId }),
    });
    return reloadQaCheck(tx, id);
  });
}

/** Appends a result and mirrors it onto the check, under a row lock. */
export async function recordQaResult(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: RecordQaResultRequest,
): Promise<{ qaCheck: QaCheckRow; result: QaResultRow }> {
  policy.assertCanManage(user);
  return deps.db.transaction(async (tx) => {
    const check = await repo.lockQaCheck(tx, id);
    if (!check) throw errors.notFound();
    const task = await repo.findTaskRef(tx, check.taskId);
    if (!task) throw new Error("QA check task not found");
    policy.assertCanManageFor(user, task);
    const resultId = await repo.insertQaResult(tx, {
      qaCheckId: id,
      outcome: input.outcome,
      note: input.note ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      recordedBy: user.id,
    });
    await repo.setLatestOutcome(tx, id, input.outcome);
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.qaResultRecorded,
      entityType: "qa_check",
      entityId: id,
      before: { outcome: check.latestOutcome },
      after: { ...linkContext(check), outcome: input.outcome, resultId, hasEvidence: input.evidenceUrl !== undefined },
    });
    const result = await repo.findQaResult(tx, resultId);
    if (!result) throw new Error("QA result not found after insert");
    return { qaCheck: await reloadQaCheck(tx, id), result };
  });
}

export async function getQaCheckDetail(deps: QualityDeps, user: User, id: string) {
  const qaCheck = await repo.findQaCheck(deps.db, id);
  if (!qaCheck) throw errors.notFound();
  const task = await repo.findTaskRef(deps.db, qaCheck.taskId);
  if (!task) throw errors.notFound();
  policy.assertCanView(user, task);
  return { qaCheck, results: await repo.qaResultsFor(deps.db, id) };
}

export async function listQaChecks(deps: QualityDeps, user: User, query: QaCheckListQuery) {
  const scope = policy.readScope(user);
  const rows = await repo.listQaChecks(deps.db, {
    assigneeId: scope === "all" ? null : user.id,
    taskId: query.taskId,
    projectId: query.projectId,
    outcome: query.outcome,
    cursor: query.cursor,
    limit: query.limit,
  });
  return page(rows, query.limit);
}

// Defects

export async function createDefect(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  taskId: string,
  input: CreateDefectRequest,
): Promise<DefectRow> {
  policy.assertCanManage(user);
  const task = await requireTask(deps, taskId);
  policy.assertCanManageFor(user, task);
  if (input.qaCheckId !== undefined) {
    const check = await repo.findQaCheck(deps.db, input.qaCheckId);
    if (check?.taskId !== taskId) throw errors.validation("The QA check must belong to the same task");
  }
  return deps.db.transaction(async (tx) => {
    const id = await repo.insertDefect(tx, {
      taskId,
      qaCheckId: input.qaCheckId ?? null,
      title: input.title,
      severity: input.severity,
      reproductionSteps: input.reproductionSteps,
      reportedBy: user.id,
    });
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.defectCreated,
      entityType: "defect",
      entityId: id,
      after: {
        ...linkContext({ taskId, projectId: task.projectId }),
        severity: input.severity,
        status: "open",
        qaCheckId: input.qaCheckId ?? null,
      },
    });
    return reloadDefect(tx, id);
  });
}

/** Managers only, while the defect is not final. */
export async function updateDefect(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: UpdateDefectRequest,
): Promise<DefectRow> {
  policy.assertCanManage(user);
  return deps.db.transaction(async (tx) => {
    const before = await lockExistingDefect(tx, id);
    policy.assertCanManageFor(user, before);
    assertNotFinal(before);
    await repo.updateDefectFields(tx, id, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      ...(input.reproductionSteps === undefined ? {} : { reproductionSteps: input.reproductionSteps }),
    });
    const after = await reloadDefect(tx, id);
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.defectUpdated,
      entityType: "defect",
      entityId: id,
      before: { severity: before.severity },
      after: {
        ...linkContext(after),
        severity: after.severity,
        titleChanged: before.title !== after.title,
        reproductionChanged: before.reproductionSteps !== after.reproductionSteps,
      },
    });
    return after;
  });
}

/** Moves allowed by DEFECT_WORKFLOW for this caller; notes are required for fixed, won't fix and reopening. */
export async function changeDefectStatus(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: DefectStatusRequest,
): Promise<DefectRow> {
  return deps.db.transaction(async (tx) => {
    const defect = await lockExistingDefect(tx, id);
    policy.assertCanMove(user, defect, input.status);
    if (defectMoveNeedsNote(defect.status, input.status) && input.note === undefined) {
      throw errors.validation("A note is required for this status change");
    }
    await repo.setDefectStatus(tx, id, input.status);
    await repo.insertDefectUpdate(tx, {
      defectId: id,
      authorId: user.id,
      note: input.note ?? null,
      evidenceUrl: null,
      fromStatus: defect.status,
      toStatus: input.status,
    });
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.defectStatusChanged,
      entityType: "defect",
      entityId: id,
      before: { status: defect.status },
      after: { ...linkContext(defect), status: input.status, severity: defect.severity },
    });
    return reloadDefect(tx, id);
  });
}

/** A note and/or https evidence from the task's assignee or a manager, while the defect is not final. */
export async function respondToDefect(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: DefectResponseRequest,
): Promise<DefectUpdateRow> {
  return deps.db.transaction(async (tx) => {
    const defect = await lockExistingDefect(tx, id);
    policy.assertCanRespond(user, defect);
    assertNotFinal(defect);
    const updateId = await repo.insertDefectUpdate(tx, {
      defectId: id,
      authorId: user.id,
      note: input.note ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      fromStatus: null,
      toStatus: null,
    });
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.defectResponded,
      entityType: "defect",
      entityId: id,
      after: {
        ...linkContext(defect),
        updateId,
        hasNote: input.note !== undefined,
        hasEvidence: input.evidenceUrl !== undefined,
      },
    });
    const update = await repo.findDefectUpdate(tx, updateId);
    if (!update) throw new Error("Defect update not found after insert");
    return update;
  });
}

export async function getDefectDetail(deps: QualityDeps, user: User, id: string) {
  const defect = await repo.findDefect(deps.db, id);
  if (!defect) throw errors.notFound();
  policy.assertCanView(user, defect);
  return { defect, updates: await repo.defectUpdatesFor(deps.db, id) };
}

export async function listDefects(deps: QualityDeps, user: User, query: DefectListQuery) {
  const scope = policy.readScope(user);
  const rows = await repo.listDefects(deps.db, {
    assigneeId: scope === "all" ? null : user.id,
    taskId: query.taskId,
    projectId: query.projectId,
    status: query.status,
    severity: query.severity,
    open: query.open === undefined ? undefined : query.open === "true",
    cursor: query.cursor,
    limit: query.limit,
  });
  return page(rows, query.limit);
}

// Release readiness

/**
 * Appends a readiness decision. "ready" is refused while the project has open critical/high defects
 * or failed/blocked QA checks. The decision reflects the state at the time it is made.
 */
export async function setReadiness(
  deps: QualityDeps,
  ctx: Ctx,
  user: User,
  projectId: string,
  input: SetReadinessRequest,
): Promise<ReadinessRow> {
  policy.assertCanManage(user);
  if (!(await projectExists(deps.db, projectId))) throw errors.notFound();
  policy.assertCanSetReadiness(user, await repo.projectHasTaskAssignedTo(deps.db, projectId, user.id));
  return deps.db.transaction(async (tx) => {
    const blockers = await repo.projectBlockers(tx, projectId);
    if (input.readiness === "ready" && blockers.defects + blockers.qaChecks > 0) {
      throw errors.conflict(
        `The release cannot be marked ready: ${String(blockers.defects)} open critical or high defect(s) and ` +
          `${String(blockers.qaChecks)} failed or blocked QA check(s)`,
      );
    }
    const id = await repo.insertReadiness(tx, {
      projectId,
      label: input.label,
      readiness: input.readiness,
      note: input.note ?? null,
      decidedBy: user.id,
    });
    await recordAudit(tx, ctx, {
      action: QUALITY_AUDIT.readinessSet,
      entityType: "project",
      entityId: projectId,
      after: {
        projectId,
        decisionId: id,
        readiness: input.readiness,
        openBlockingDefects: blockers.defects,
        failedOrBlockedQaChecks: blockers.qaChecks,
      },
    });
    const decision = await repo.findReadiness(tx, id);
    if (!decision) throw new Error("Readiness decision not found after insert");
    return decision;
  });
}

export async function listReadiness(deps: QualityDeps, user: User, projectId: string, query: PaginationQuery) {
  policy.assertCanReadAll(user);
  if (!(await projectExists(deps.db, projectId))) throw errors.notFound();
  return page(await repo.listReadiness(deps.db, projectId, query.cursor, query.limit), query.limit);
}

/** Exact counts over everything; only the per-project rows are capped. */
export async function qualitySummary(deps: QualityDeps, user: User) {
  policy.assertCanReadAll(user);
  const [counts, rows] = await Promise.all([
    repo.summaryCounts(deps.db),
    repo.projectBlockerRows(deps.db, QUALITY_PROJECT_ROW_CAP + 1),
  ]);
  return { counts, projects: rows.slice(0, QUALITY_PROJECT_ROW_CAP), capped: rows.length > QUALITY_PROJECT_ROW_CAP };
}
