import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

export function assertCanCreateUser(user: User): void {
  if (!can(user, "users:create")) throw errors.forbidden();
}

export function assertCanResetAccess(user: User): void {
  if (!can(user, "users:reset_access")) throw errors.forbidden();
}

export function assertCanReadDirectory(user: User): void {
  if (!can(user, "users:read_directory")) throw errors.forbidden();
}

export function canReadEmail(user: User): boolean {
  return can(user, "users:read_email");
}
