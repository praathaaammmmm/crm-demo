export const QUALITY_AUDIT = {
  qaCheckCreated: "qa_check.created",
  qaResultRecorded: "qa_check.result_recorded",
  defectCreated: "defect.created",
  defectUpdated: "defect.updated",
  defectStatusChanged: "defect.status_changed",
  defectResponded: "defect.responded",
  readinessSet: "release.readiness_set",
} as const;

/**
 * Allowlisted context for quality audit snapshots (docs/security/audit-policy.md).
 * Titles, notes, reproduction steps, evidence URLs and readiness labels are never recorded.
 */
export function linkContext(item: { taskId: string; projectId: string }): Record<string, unknown> {
  return { taskId: item.taskId, projectId: item.projectId };
}
