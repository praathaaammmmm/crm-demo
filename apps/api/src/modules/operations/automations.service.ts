import {
  automationAcceptsRuns,
  automationEditable,
  automationHealth,
  automationNoteRequired,
  automationTransition,
  type AutomationHealth,
  type AutomationListQuery,
  type AutomationStatusRequest,
  type CreateAutomationRequest,
  type RecordRunRequest,
  type UpdateAutomationRequest,
} from "@crm/contracts/operations";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { defined } from "../../platform/defined.js";
import { guardedTransaction, pageOf } from "../../platform/transactions.js";
import { recordAudit } from "../audit/index.js";
import * as repo from "./automations.repository.js";
import type { AutomationRow, ChangeRow, RunRow } from "./automations.repository.js";
import type { OperationsDeps } from "./incidents.service.js";
import { changedFlags, OPERATIONS_AUDIT } from "./operations.audit.js";
import * as policy from "./operations.policy.js";

type User = AuthSession["user"];

const ENTITY = "ops_automation";
const FIELDS = ["name", "purpose", "triggerDescription"] as const;

/** Health from the five most recent recorded outcomes. */
export const healthOf = (row: AutomationRow): AutomationHealth =>
  automationHealth(row.recentOutcomes.filter((outcome): outcome is "succeeded" | "failed" => outcome === "succeeded" || outcome === "failed"));

async function lockExisting(tx: Tx, id: string): Promise<AutomationRow> {
  const automation = await repo.lockAutomation(tx, id);
  if (!automation) throw errors.notFound();
  return automation;
}

async function reload(tx: Tx, id: string): Promise<AutomationRow> {
  const automation = await repo.findAutomation(tx, id);
  if (!automation) throw new Error("Automation not found after change");
  return automation;
}

export async function listAutomations(deps: OperationsDeps, user: User, query: AutomationListQuery) {
  policy.assertCanRead(user);
  return pageOf(await repo.listAutomations(deps.db, { status: query.status, cursor: query.cursor, limit: query.limit }), query.limit);
}

export async function getAutomation(deps: OperationsDeps, user: User, id: string): Promise<{ automation: AutomationRow; runs: RunRow[]; changes: ChangeRow[] }> {
  policy.assertCanRead(user);
  const automation = await repo.findAutomation(deps.db, id);
  if (!automation) throw errors.notFound();
  return { automation, runs: await repo.recentRuns(deps.db, id), changes: await repo.changes(deps.db, id) };
}

export async function createAutomation(deps: OperationsDeps, ctx: Ctx, user: User, input: CreateAutomationRequest): Promise<AutomationRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const id = await repo.insertAutomation(tx, { name: input.name, purpose: input.purpose, triggerDescription: input.trigger, createdBy: user.id });
    const automation = await reload(tx, id);
    await recordAudit(tx, ctx, { action: OPERATIONS_AUDIT.automationCreated, entityType: ENTITY, entityId: id, after: { status: automation.status } });
    return automation;
  });
}

export async function updateAutomation(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: UpdateAutomationRequest): Promise<AutomationRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    if (!automationEditable(before.status)) throw errors.conflict("Only a draft or testing automation can be edited");
    await repo.updateAutomation(tx, id, defined({ name: input.name, purpose: input.purpose, triggerDescription: input.trigger }));
    const after = await reload(tx, id);
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.automationUpdated,
      entityType: ENTITY,
      entityId: id,
      after: { status: after.status, ...changedFlags(before, after, FIELDS) },
    });
    return after;
  });
}

/** Lifecycle changes append an immutable change row; going live needs CEO/CTO approval. */
export async function moveAutomation(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: AutomationStatusRequest): Promise<AutomationRow> {
  policy.assertCanAct(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    const actor = automationTransition(before.status, input.to);
    if (actor === null) throw errors.conflict("This automation cannot move to that status");
    if (actor === "approver") policy.assertCanApprove(user);
    else policy.assertCanManage(user);
    if (automationNoteRequired(before.status, input.to) && input.note === undefined) throw errors.validation("Sending an automation back needs a note");
    await repo.updateAutomation(tx, id, { status: input.to });
    await repo.insertChange(tx, { automationId: id, fromStatus: before.status, toStatus: input.to, note: input.note ?? null, actorId: user.id });
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.automationStatusChanged,
      entityType: ENTITY,
      entityId: id,
      before: { status: before.status },
      after: { status: input.to, noteAdded: input.note !== undefined },
    });
    return reload(tx, id);
  });
}

/** A run is a record the VP enters; nothing is executed. The error summary never reaches the audit log. */
export async function recordRun(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: RecordRunRequest): Promise<RunRow> {
  policy.assertCanManage(user);
  const finishedAt = new Date(input.finishedAt);
  if (finishedAt.getTime() > Date.now() + 5 * 60_000) throw errors.validation("A run cannot finish in the future");
  return guardedTransaction(deps.db, async (tx) => {
    const automation = await lockExisting(tx, id);
    if (!automationAcceptsRuns(automation.status)) throw errors.conflict("Runs are recorded only for testing, live or paused automations");
    const run = await repo.insertRun(tx, {
      automationId: id,
      startedAt: new Date(input.startedAt),
      finishedAt,
      outcome: input.outcome,
      errorSummary: input.errorSummary ?? null,
      recordedBy: user.id,
    });
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.automationRunRecorded,
      entityType: "ops_automation_run",
      entityId: run.id,
      after: { automationId: id, outcome: run.outcome },
    });
    return run;
  });
}
