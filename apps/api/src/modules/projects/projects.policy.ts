import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

export function assertCanCreate(user: User): void {
  if (!can(user, "projects:create")) throw errors.forbidden();
}

/** "all" for the CEO; "assigned" for users who may see projects containing their tasks. */
export function readScope(user: User): "all" | "assigned" {
  if (can(user, "projects:read_all")) return "all";
  if (can(user, "projects:read_assigned")) return "assigned";
  throw errors.forbidden();
}
