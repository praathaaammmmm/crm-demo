import type { ApprovalListQuery, CreateApprovalRequest } from "@crm/contracts/approvals";
import type { Database } from "@crm/database/client";
import type { ApprovalType } from "@crm/permissions";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors, isUniqueViolation } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { APPROVAL_AUDIT, approvalSnapshot } from "./approvals.audit.js";
import * as policy from "./approvals.policy.js";
import * as repo from "./approvals.repository.js";
import type { ApprovalRow } from "./approvals.repository.js";

type User = AuthSession["user"];

/** What an approval handler needs to check and carry out a requested change. */
export interface ApprovalTarget {
  type: ApprovalType;
  targetUserId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
}

/**
 * Implemented by the module that owns the change (organization for user changes).
 * validate() locks and checks the target and throws an AppError if the change no longer applies;
 * execute() makes the change and records its own audit event, inside the approval's transaction.
 */
export interface ApprovalHandler {
  validate(tx: Tx, target: ApprovalTarget): Promise<void>;
  execute(tx: Tx, ctx: Ctx, target: ApprovalTarget): Promise<void>;
}

export type ApprovalHandlers = Readonly<Record<ApprovalType, ApprovalHandler>>;

export interface ApprovalDeps {
  db: Database;
  handlers: ApprovalHandlers;
}

const targetOf = (row: ApprovalRow): ApprovalTarget => ({
  type: row.type,
  targetUserId: row.targetUserId,
  payload: row.payload,
  requestedBy: row.requestedBy,
});

async function approveWithin(
  tx: Tx,
  deps: ApprovalDeps,
  ctx: Ctx,
  user: User,
  row: ApprovalRow,
  note: string | null,
): Promise<ApprovalRow> {
  const decided = await repo.markDecided(tx, row.id, { status: "approved", decidedBy: user.id, decisionNote: note });
  await recordAudit(tx, ctx, {
    action: APPROVAL_AUDIT.approved,
    entityType: "approval_request",
    entityId: row.id,
    before: approvalSnapshot(row),
    after: approvalSnapshot(decided),
  });
  await deps.handlers[row.type].execute(tx, ctx, targetOf(row));
  return decided;
}

/**
 * Creates a request. Non-CEO requesters get a pending request; the CEO's own request is approved
 * and carried out in the same transaction.
 */
export async function requestApproval(
  deps: ApprovalDeps,
  ctx: Ctx,
  user: User,
  input: CreateApprovalRequest,
): Promise<ApprovalRow> {
  policy.assertCanRequest(user, input.type);
  if (input.targetUserId === user.id) throw errors.forbidden("You cannot request a change to your own account");

  const target: ApprovalTarget = {
    type: input.type,
    targetUserId: input.targetUserId,
    payload: input.payload,
    requestedBy: user.id,
  };

  try {
    return await deps.db.transaction(async (tx) => {
      await deps.handlers[input.type].validate(tx, target);
      const id = await repo.insertRequest(tx, { ...target, reason: input.reason });
      const created = await repo.findById(tx, id);
      if (!created) throw new Error("Approval request not found after insert");
      await recordAudit(tx, ctx, {
        action: APPROVAL_AUDIT.requested,
        entityType: "approval_request",
        entityId: id,
        after: approvalSnapshot(created),
      });
      return policy.canDecide(user) ? approveWithin(tx, deps, ctx, user, created, null) : created;
    });
  } catch (error) {
    if (isUniqueViolation(error, "approval_requests_one_pending")) {
      throw errors.conflict("A pending request of this type already exists for this user");
    }
    throw error;
  }
}

/** CEO only. Re-checks the target; if the change no longer applies the request stays pending (409). */
export async function approveRequest(
  deps: ApprovalDeps,
  ctx: Ctx,
  user: User,
  id: string,
  note: string | null,
): Promise<ApprovalRow> {
  policy.assertCanDecide(user);
  return deps.db.transaction(async (tx) => {
    const row = await repo.findByIdForUpdate(tx, id);
    if (!row) throw errors.notFound();
    if (row.status !== "pending") throw errors.conflict("This request is no longer pending");
    await deps.handlers[row.type].validate(tx, targetOf(row));
    return approveWithin(tx, deps, ctx, user, row, note);
  });
}

/** CEO only. A note is required (enforced by the request contract). */
export async function rejectRequest(
  deps: ApprovalDeps,
  ctx: Ctx,
  user: User,
  id: string,
  note: string,
): Promise<ApprovalRow> {
  policy.assertCanDecide(user);
  return deps.db.transaction(async (tx) => {
    const row = await repo.findByIdForUpdate(tx, id);
    if (!row) throw errors.notFound();
    if (row.status !== "pending") throw errors.conflict("This request is no longer pending");
    const decided = await repo.markDecided(tx, id, { status: "rejected", decidedBy: user.id, decisionNote: note });
    await recordAudit(tx, ctx, {
      action: APPROVAL_AUDIT.rejected,
      entityType: "approval_request",
      entityId: id,
      before: approvalSnapshot(row),
      after: approvalSnapshot(decided),
    });
    return decided;
  });
}

/** The requester only, while pending. Other requesters get 404; the CEO gets 403. */
export async function cancelRequest(deps: ApprovalDeps, ctx: Ctx, user: User, id: string): Promise<ApprovalRow> {
  return deps.db.transaction(async (tx) => {
    const row = await repo.findByIdForUpdate(tx, id);
    if (!row) throw errors.notFound();
    policy.assertCanCancel(user, row);
    if (row.status !== "pending") throw errors.conflict("This request is no longer pending");
    const decided = await repo.markDecided(tx, id, { status: "cancelled", decidedBy: null, decisionNote: null });
    await recordAudit(tx, ctx, {
      action: APPROVAL_AUDIT.cancelled,
      entityType: "approval_request",
      entityId: id,
      before: approvalSnapshot(row),
      after: approvalSnapshot(decided),
    });
    return decided;
  });
}

export async function listApprovals(
  deps: ApprovalDeps,
  user: User,
  query: ApprovalListQuery,
): Promise<{ items: ApprovalRow[]; nextCursor: string | null }> {
  const { onlyOwn } = policy.assertCanList(user);
  const rows = await repo.list(deps.db, {
    requestedBy: onlyOwn ? user.id : null,
    status: query.status,
    cursor: query.cursor,
    limit: query.limit,
  });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > query.limit && last ? last.id : null };
}
