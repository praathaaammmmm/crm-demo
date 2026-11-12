import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

/** Every Operations read: the CEO/CTO and the VP Engineering & Quality. */
export function assertCanRead(user: User): void {
  if (!can(user, "operations:read_all")) throw errors.forbidden();
}

/** Every Operations write except approvals: the VP Engineering & Quality only (ADR 0012). */
export function assertCanManage(user: User): void {
  if (!can(user, "operations:manage")) throw errors.forbidden();
}

/** Production release and automation go-live decisions: the CEO/CTO only. */
export function assertCanApprove(user: User): void {
  if (!can(user, "operations:approve")) throw errors.forbidden();
}

/** A workflow step needs either the manage or the approve permission. */
export function assertCanAct(user: User): void {
  if (!can(user, "operations:manage") && !can(user, "operations:approve")) throw errors.forbidden();
}
