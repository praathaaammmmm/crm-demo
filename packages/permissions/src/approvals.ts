import type { Permission } from "./roles.js";

/** Actions that require CEO/CTO approval (docs/security/rbac-matrix.md). */
export const APPROVAL_TYPES = ["user.role_change", "user.deactivate"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

/** The permission needed to request each approval type. */
export const REQUEST_PERMISSION: Readonly<Record<ApprovalType, Permission>> = {
  "user.role_change": "approvals:request_role_change",
  "user.deactivate": "approvals:request_deactivation",
};
