import { APPROVAL_PERMISSIONS } from "./catalog/approvals.js";
import { ORGANIZATION_PERMISSIONS } from "./catalog/organization.js";
import { PROJECT_PERMISSIONS } from "./catalog/projects.js";
import { MEETING_PERMISSIONS, NOTIFICATION_PERMISSIONS } from "./catalog/meetings.js";
import { QUALITY_PERMISSIONS } from "./catalog/quality.js";
import { TASK_PERMISSIONS } from "./catalog/tasks.js";

// Must match the database enum `user_role` (checked by apps/api/test/roles.test.ts).
// See docs/security/rbac-matrix.md.
export const ROLES = [
  "ceo_cto",
  "cfo",
  "cgo",
  "cmo",
  "vp_engineering_quality",
  "founder",
  "employee",
  "intern",
  "contractor",
] as const;

export type Role = (typeof ROLES)[number];

/** Every role except the Super Admin role, which only the bootstrap command can assign. */
export const ASSIGNABLE_ROLES = [
  "cfo",
  "cgo",
  "cmo",
  "vp_engineering_quality",
  "founder",
  "employee",
  "intern",
  "contractor",
] as const satisfies readonly Role[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PERMISSIONS = [
  ...ORGANIZATION_PERMISSIONS,
  ...APPROVAL_PERMISSIONS,
  ...PROJECT_PERMISSIONS,
  ...TASK_PERMISSIONS,
  ...QUALITY_PERMISSIONS,
  ...MEETING_PERMISSIONS,
  ...NOTIFICATION_PERMISSIONS,
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Every team member: work only on tasks assigned to them, see those tasks' projects, and respond to their quality items. */
const ASSIGNEE: readonly Permission[] = [
  "projects:read_assigned",
  "tasks:read_assigned",
  "tasks:update_assigned",
  "quality:read_assigned",
  "quality:respond_assigned",
  "meetings:read_invited",
  "meetings:respond",
  "notifications:read_own",
];

const REQUESTER: readonly Permission[] = [
  ...ASSIGNEE,
  "users:read_directory",
  "approvals:request_role_change",
  "approvals:request_deactivation",
];

/** Deny by default: a role has exactly these permissions and nothing else. */
export const ROLE_GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  ceo_cto: PERMISSIONS,
  cfo: REQUESTER,
  cgo: REQUESTER,
  cmo: REQUESTER,
  // Read-only access to all tasks and projects; task creation, editing and review stay CEO-only.
  vp_engineering_quality: [...REQUESTER, "tasks:read_all", "projects:read_all", "quality:read_all", "quality:manage"],
  founder: ASSIGNEE,
  employee: ASSIGNEE,
  intern: ASSIGNEE,
  contractor: ASSIGNEE,
};
