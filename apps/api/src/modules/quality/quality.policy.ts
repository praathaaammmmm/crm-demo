import { canAssigneeMoveDefect, canManagerMoveDefect, type DefectStatus } from "@crm/contracts/quality";
import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

/** A quality item as seen by policy: its linked task's current assignee. */
interface Linked {
  assigneeId: string;
}

/** Create checks, record results, create and edit defects, decide defects, set readiness. */
export function assertCanManage(user: User): void {
  if (!can(user, "quality:manage")) throw errors.forbidden();
}

const SELF_QA = "You cannot manage quality for work assigned to you";

/**
 * Self-QA conflict: a quality manager who is the current assignee of the linked task is treated as an
 * assignee for that task's quality items. Only the CEO/CTO (never an assignee) or another manager may
 * create checks, record results, create or edit defects, or decide on them.
 */
export function assertCanManageFor(user: User, item: Linked): void {
  assertCanManage(user);
  if (item.assigneeId === user.id) throw errors.forbidden(SELF_QA);
}

/** Readiness for a project in which the caller has an assigned task is a self-QA conflict. */
export function assertCanSetReadiness(user: User, hasOwnTaskInProject: boolean): void {
  assertCanManage(user);
  if (hasOwnTaskInProject) throw errors.forbidden(SELF_QA);
}

/** Quality summary and readiness history: VP Engineering & Quality and the CEO/CTO. */
export function assertCanReadAll(user: User): void {
  if (!can(user, "quality:read_all")) throw errors.forbidden();
}

/** "all" for VP and the CEO; "assigned" for users limited to quality items on their own tasks. */
export function readScope(user: User): "all" | "assigned" {
  if (can(user, "quality:read_all")) return "all";
  if (can(user, "quality:read_assigned")) return "assigned";
  throw errors.forbidden();
}

/** An item the caller may not see is reported as 404. */
export function assertCanView(user: User, item: Linked): void {
  if (readScope(user) === "assigned" && item.assigneeId !== user.id) throw errors.notFound();
}

/** Notes and evidence: the linked task's assignee, or a quality manager. */
export function assertCanRespond(user: User, item: Linked): void {
  assertCanView(user, item);
  if (can(user, "quality:manage")) return;
  if (item.assigneeId === user.id && can(user, "quality:respond_assigned")) return;
  throw errors.forbidden();
}

/**
 * Status changes follow DEFECT_WORKFLOW. Manager moves need quality:manage and are never allowed on a
 * defect whose task is assigned to the caller, so nobody decides on defects in their own work.
 */
export function assertCanMove(user: User, defect: Linked & { status: DefectStatus }, to: DefectStatus): void {
  assertCanView(user, defect);
  if (canManagerMoveDefect(defect.status, to)) {
    assertCanManageFor(user, defect);
    return;
  }
  if (canAssigneeMoveDefect(defect.status, to)) {
    if (defect.assigneeId !== user.id || !can(user, "quality:respond_assigned")) throw errors.forbidden();
    return;
  }
  throw errors.conflict("This status change is not allowed");
}
