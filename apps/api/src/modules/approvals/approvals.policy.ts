import { can, REQUEST_PERMISSION, type ApprovalType } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

export function assertCanRequest(user: User, type: ApprovalType): void {
  if (!can(user, REQUEST_PERMISSION[type])) throw errors.forbidden();
}

export function canDecide(user: User): boolean {
  return can(user, "approvals:decide");
}

export function assertCanDecide(user: User): void {
  if (!canDecide(user)) throw errors.forbidden();
}

function canReadAll(user: User): boolean {
  return can(user, "approvals:read_all");
}

/** Requesters may list their own requests; the CEO may list all. Everyone else gets 403. */
export function assertCanList(user: User): { onlyOwn: boolean } {
  if (canReadAll(user)) return { onlyOwn: false };
  if (Object.values(REQUEST_PERMISSION).some((permission) => can(user, permission))) return { onlyOwn: true };
  throw errors.forbidden();
}

/** A request the caller may not see is reported as 404, not 403. */
export function assertVisible(user: User, request: { requestedBy: string }): void {
  if (!canReadAll(user) && request.requestedBy !== user.id) throw errors.notFound();
}

export function assertCanCancel(user: User, request: { requestedBy: string }): void {
  assertVisible(user, request);
  if (request.requestedBy !== user.id) throw errors.forbidden();
}
