import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

/** Every Marketing read: the CEO/CTO and the CMO. */
export function assertCanRead(user: User): void {
  if (!can(user, "marketing:read_all")) throw errors.forbidden();
}

/** Every Marketing write: the CMO only. The CEO/CTO is read-only here (ADR 0011). */
export function assertCanManage(user: User): void {
  if (!can(user, "marketing:manage")) throw errors.forbidden();
}
