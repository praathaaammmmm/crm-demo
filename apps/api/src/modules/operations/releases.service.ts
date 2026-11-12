import {
  releaseEditable,
  releaseNoteRequired,
  releaseTransition,
  type CreateReleaseRequest,
  type ReleaseDecisionRequest,
  type ReleaseListQuery,
  type UpdateReleaseRequest,
} from "@crm/contracts/operations";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { defined } from "../../platform/defined.js";
import { guardedTransaction, pageOf } from "../../platform/transactions.js";
import { recordAudit } from "../audit/index.js";
import type { OperationsDeps } from "./incidents.service.js";
import { changedFlags, OPERATIONS_AUDIT } from "./operations.audit.js";
import * as policy from "./operations.policy.js";
import * as repo from "./releases.repository.js";
import type { ChecklistRow, DecisionRow, ReleaseRow } from "./releases.repository.js";

type User = AuthSession["user"];

const ENTITY = "ops_release";
const FIELDS = ["name", "versionLabel", "plannedFor", "notes"] as const;

async function lockExisting(tx: Tx, id: string): Promise<ReleaseRow> {
  const release = await repo.lockRelease(tx, id);
  if (!release) throw errors.notFound();
  return release;
}

async function reload(tx: Tx, id: string): Promise<ReleaseRow> {
  const release = await repo.findRelease(tx, id);
  if (!release) throw new Error("Release not found after change");
  return release;
}

const assertDraft = (release: ReleaseRow) => {
  if (!releaseEditable(release.status)) throw errors.conflict("Only a draft release can change");
};

export async function listReleases(deps: OperationsDeps, user: User, query: ReleaseListQuery) {
  policy.assertCanRead(user);
  const rows = await repo.listReleases(deps.db, { status: query.status, environment: query.environment, cursor: query.cursor, limit: query.limit });
  return pageOf(rows, query.limit);
}

export async function getRelease(
  deps: OperationsDeps,
  user: User,
  id: string,
): Promise<{ release: ReleaseRow; checklist: ChecklistRow[]; decisions: DecisionRow[] }> {
  policy.assertCanRead(user);
  const release = await repo.findRelease(deps.db, id);
  if (!release) throw errors.notFound();
  return { release, checklist: await repo.checklist(deps.db, id), decisions: await repo.decisions(deps.db, id) };
}

export async function createRelease(deps: OperationsDeps, ctx: Ctx, user: User, input: CreateReleaseRequest): Promise<ReleaseRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const id = await repo.insertRelease(tx, {
      name: input.name,
      versionLabel: input.versionLabel,
      environment: input.environment,
      plannedFor: input.plannedFor ?? null,
      notes: input.notes ?? null,
      createdBy: user.id,
    });
    const release = await reload(tx, id);
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.releaseCreated,
      entityType: ENTITY,
      entityId: id,
      after: { environment: release.environment, status: release.status, plannedFor: release.plannedFor },
    });
    return release;
  });
}

export async function updateRelease(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: UpdateReleaseRequest): Promise<ReleaseRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    assertDraft(before);
    await repo.updateRelease(tx, id, defined(input));
    const after = await reload(tx, id);
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.releaseUpdated,
      entityType: ENTITY,
      entityId: id,
      before: { plannedFor: before.plannedFor },
      after: { plannedFor: after.plannedFor, ...changedFlags(before, after, FIELDS) },
    });
    return after;
  });
}

export async function addChecklistItem(deps: OperationsDeps, ctx: Ctx, user: User, releaseId: string, label: string): Promise<ChecklistRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    assertDraft(await lockExisting(tx, releaseId));
    const item = await repo.insertChecklistItem(tx, { releaseId, label, createdBy: user.id });
    await recordAudit(tx, ctx, { action: OPERATIONS_AUDIT.releaseChecklistItemAdded, entityType: "ops_release_checklist_item", entityId: item.id, after: { releaseId } });
    return item;
  });
}

export async function setChecklistItem(deps: OperationsDeps, ctx: Ctx, user: User, itemId: string, done: boolean): Promise<ChecklistRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const item = await repo.findChecklistItem(tx, itemId);
    if (!item) throw errors.notFound();
    assertDraft(await lockExisting(tx, item.releaseId));
    if (item.done === done) return item;
    const updated = await repo.setChecklistItem(tx, itemId, done, user.id);
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.releaseChecklistItemChanged,
      entityType: "ops_release_checklist_item",
      entityId: itemId,
      before: { done: item.done },
      after: { releaseId: item.releaseId, done },
    });
    return updated;
  });
}

/**
 * Every release status change, including CEO approval decisions and the rollback record, appends an immutable
 * decision row. The VP records work; only the CEO/CTO approves or rejects production releases. Nothing deploys.
 */
export async function decide(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: ReleaseDecisionRequest): Promise<ReleaseRow> {
  policy.assertCanAct(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    const actor = releaseTransition(before.environment, before.status, input.to);
    if (actor === null) throw errors.conflict("This release cannot move to that status");
    if (actor === "approver") policy.assertCanApprove(user);
    else policy.assertCanManage(user);
    if (releaseNoteRequired(input.to) && input.note === undefined) throw errors.validation("This decision needs a note");
    if (before.status === "draft" && (before.checklistTotal === 0 || before.checklistDone < before.checklistTotal)) {
      throw errors.conflict("Complete the release checklist first");
    }
    await repo.updateRelease(tx, id, { status: input.to });
    await repo.insertDecision(tx, { releaseId: id, fromStatus: before.status, toStatus: input.to, note: input.note ?? null, actorId: user.id });
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.releaseStatusChanged,
      entityType: ENTITY,
      entityId: id,
      before: { status: before.status },
      after: { status: input.to, environment: before.environment, noteAdded: input.note !== undefined },
    });
    return reload(tx, id);
  });
}
