import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

function requirePermission(user: User, permission: string): void {
  if (!can(user, permission)) throw errors.forbidden();
}

export const assertCanCreate = (user: User): void => {
  requirePermission(user, "tasks:create");
};
export const assertCanManage = (user: User): void => {
  requirePermission(user, "tasks:manage");
};
export const assertCanReview = (user: User): void => {
  requirePermission(user, "tasks:review");
};
export const assertCanReadAll = (user: User): void => {
  requirePermission(user, "tasks:read_all");
};

/** "all" for the CEO; "assigned" for users limited to their own tasks. */
export function readScope(user: User): "all" | "assigned" {
  if (can(user, "tasks:read_all")) return "all";
  if (can(user, "tasks:read_assigned")) return "assigned";
  throw errors.forbidden();
}

/** A task the caller may not see is reported as 404. */
export function assertCanView(user: User, task: { assigneeId: string }): void {
  if (readScope(user) === "assigned" && task.assigneeId !== user.id) throw errors.notFound();
}

/**
 * Status changes, notes, proofs and submission are for the current assignee only.
 * The CEO can see the task, so gets 403; anyone else gets 404.
 */
export function assertAssigneeAction(user: User, task: { assigneeId: string }): void {
  if (task.assigneeId === user.id && can(user, "tasks:update_assigned")) return;
  if (can(user, "tasks:read_all")) throw errors.forbidden();
  throw errors.notFound();
}
