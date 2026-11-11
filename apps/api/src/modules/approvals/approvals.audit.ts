export const APPROVAL_AUDIT = {
  requested: "approval.requested",
  approved: "approval.approved",
  rejected: "approval.rejected",
  cancelled: "approval.cancelled",
} as const;

/**
 * Allowlisted approval fields for audit snapshots (docs/security/audit-policy.md):
 * type, status, target, and the type's own payload field. Never the free-text reason or note.
 */
export function approvalSnapshot(request: {
  type: string;
  status: string;
  targetUserId: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    type: request.type,
    status: request.status,
    targetUserId: request.targetUserId,
  };
  if (typeof request.payload["newRole"] === "string") snapshot["newRole"] = request.payload["newRole"];
  return snapshot;
}
