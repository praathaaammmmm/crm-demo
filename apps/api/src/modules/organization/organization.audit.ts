export const ORGANIZATION_AUDIT = {
  superAdminBootstrapped: "system.super_admin_bootstrapped",
  userCreated: "user.created",
  roleChanged: "user.role_changed",
  deactivated: "user.deactivated",
  accessReset: "user.access_reset",
} as const;

/** Allowlisted user fields for audit before/after snapshots (docs/security/audit-policy.md). */
export function userSnapshot(user: { role: string; status: string }): Record<string, unknown> {
  return { role: user.role, status: user.status };
}
