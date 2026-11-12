import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

/** Companies (and read-only views): the CEO/CTO and the CGO. */
export function assertCanRead(user: User): void {
  if (!can(user, "growth:read_all")) throw errors.forbidden();
}

/** Contact personal data: the CEO/CTO and the CGO. */
export function assertCanReadContacts(user: User): void {
  if (!can(user, "growth:read_contacts")) throw errors.forbidden();
}

/** Lead reassignment: the CEO/CTO only. */
export function assertCanReassign(user: User): void {
  if (!can(user, "growth:reassign")) throw errors.forbidden();
}

/** Reopening lost leads: the CEO/CTO only. */
export function assertCanReopen(user: User): void {
  if (!can(user, "growth:reopen")) throw errors.forbidden();
}

/** Activity timelines show contact links: both read permissions are needed. */
export function assertCanReadActivities(user: User): void {
  if (!can(user, "growth:read_all") || !can(user, "growth:read_contacts")) throw errors.forbidden();
}

/** Every Growth write: the CGO only. The CEO/CTO is read-only here (ADR 0008). */
export function assertCanManage(user: User): void {
  if (!can(user, "growth:manage")) throw errors.forbidden();
}

/** CEO/CTO only: decisions that advance or refuse a proposal. */
export function assertCanApproveProposals(user: User): void {
  if (!can(user, "growth:approve_proposals")) throw errors.forbidden();
}
