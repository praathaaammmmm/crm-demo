import { APPROVAL_PERMISSIONS } from "./catalog/approvals.js";
import { ORGANIZATION_PERMISSIONS } from "./catalog/organization.js";
import { PROJECT_PERMISSIONS } from "./catalog/projects.js";
import { GROWTH_PERMISSIONS } from "./catalog/growth.js";
import { MARKETING_PERMISSIONS } from "./catalog/marketing.js";
import { MEETING_PERMISSIONS, NOTIFICATION_PERMISSIONS } from "./catalog/meetings.js";
import { OPERATIONS_PERMISSIONS } from "./catalog/operations.js";
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
  ...GROWTH_PERMISSIONS,
  ...MARKETING_PERMISSIONS,
  ...OPERATIONS_PERMISSIONS,
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

/** Area write permissions the CEO/CTO never holds: it reads those areas and approves where stated. */
const CEO_EXCLUDED: readonly Permission[] = ["growth:manage", "marketing:manage", "operations:manage"];

/** Deny by default: a role has exactly these permissions and nothing else. */
export const ROLE_GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  // Read-only Growth, Marketing and Operations access: every permission except the area manage permissions
  // (ADR 0008, 0011, 0012). The CEO/CTO alone approves production releases and automation go-live.
  ceo_cto: PERMISSIONS.filter((permission) => !CEO_EXCLUDED.includes(permission)),
  cfo: REQUESTER,
  cgo: [...REQUESTER, "growth:read_all", "growth:read_contacts", "growth:manage"],
  cmo: [...REQUESTER, "marketing:read_all", "marketing:manage"],
  // Read-only access to all tasks and projects; task creation, editing and review stay CEO-only.
  vp_engineering_quality: [
    ...REQUESTER,
    "tasks:read_all",
    "projects:read_all",
    "quality:read_all",
    "quality:manage",
    "operations:read_all",
    "operations:manage",
  ],
  founder: ASSIGNEE,
  employee: ASSIGNEE,
  intern: ASSIGNEE,
  contractor: ASSIGNEE,
};
