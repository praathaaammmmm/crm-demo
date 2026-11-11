import { describe, expect, it } from "vitest";
import { can } from "./can.js";
import { PERMISSIONS, ROLES, type Permission, type Role } from "./roles.js";

// Written out explicitly so any change to a role's permissions must also change this table
// and docs/security/rbac-matrix.md.
const ASSIGNEE: Permission[] = [
  "projects:read_assigned",
  "tasks:read_assigned",
  "tasks:update_assigned",
  "quality:read_assigned",
  "quality:respond_assigned",
  "meetings:read_invited",
  "meetings:respond",
  "notifications:read_own",
];
const REQUESTER: Permission[] = [
  ...ASSIGNEE,
  "users:read_directory",
  "approvals:request_role_change",
  "approvals:request_deactivation",
];

const EXPECTED: Record<Role, Permission[]> = {
  ceo_cto: [
    "users:create",
    "users:read_directory",
    "users:read_email",
    "approvals:request_role_change",
    "approvals:request_deactivation",
    "approvals:decide",
    "approvals:read_all",
    "projects:create",
    "projects:read_all",
    "projects:read_assigned",
    "tasks:create",
    "tasks:manage",
    "tasks:read_all",
    "tasks:review",
    "tasks:read_assigned",
    "tasks:update_assigned",
    "quality:read_all",
    "quality:manage",
    "quality:read_assigned",
    "quality:respond_assigned",
    "meetings:manage",
    "meetings:read_all",
    "meetings:read_invited",
    "meetings:respond",
    "notifications:read_own",
  ],
  cfo: REQUESTER,
  cgo: REQUESTER,
  cmo: REQUESTER,
  vp_engineering_quality: [...REQUESTER, "tasks:read_all", "projects:read_all", "quality:read_all", "quality:manage"],
  founder: ASSIGNEE,
  employee: ASSIGNEE,
  intern: ASSIGNEE,
  contractor: ASSIGNEE,
};

describe("role × permission matrix", () => {
  it.each(ROLES)("%s has exactly its documented permissions", (role) => {
    const granted = PERMISSIONS.filter((permission) => can({ role }, permission));
    expect([...granted].sort()).toEqual([...EXPECTED[role]].sort());
  });
});
