import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

/** Create, edit and cancel meetings: the CEO/CTO only. */
export function assertCanManage(user: User): void {
  if (!can(user, "meetings:manage")) throw errors.forbidden();
}

/** Meeting summary: the CEO/CTO only. */
export function assertCanReadAll(user: User): void {
  if (!can(user, "meetings:read_all")) throw errors.forbidden();
}

/** "all" for the CEO/CTO; "invited" for everyone else, limited to meetings where they are a current attendee. */
export function readScope(user: User): "all" | "invited" {
  if (can(user, "meetings:read_all")) return "all";
  if (can(user, "meetings:read_invited")) return "invited";
  throw errors.forbidden();
}

/** A meeting the caller may not see is reported as 404. */
export function assertCanView(user: User, isCurrentAttendee: boolean): void {
  if (readScope(user) === "invited" && !isCurrentAttendee) throw errors.notFound();
}

/**
 * Responses are for current attendees only. Someone who can see every meeting but is not invited gets
 * 403; anyone else gets 404.
 */
export function assertCanRespond(user: User, isCurrentAttendee: boolean): void {
  if (isCurrentAttendee && can(user, "meetings:respond")) return;
  if (can(user, "meetings:read_all")) throw errors.forbidden();
  throw errors.notFound();
}
