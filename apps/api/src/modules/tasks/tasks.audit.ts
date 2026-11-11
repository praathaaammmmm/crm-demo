export const TASK_AUDIT = {
  created: "task.created",
  updated: "task.updated",
  statusChanged: "task.status_changed",
  progressNoted: "task.progress_noted",
  proofAdded: "task.proof_added",
  submitted: "task.submitted",
  reviewed: "task.reviewed",
  completed: "task.completed",
} as const;

/**
 * Allowlisted task fields for audit snapshots (docs/security/audit-policy.md).
 * Titles, descriptions, notes and proof URLs are never recorded in audit events.
 */
export function taskSnapshot(task: {
  assigneeId: string;
  priority: string;
  dueDate: string;
  status: string;
}): Record<string, unknown> {
  return { assigneeId: task.assigneeId, priority: task.priority, dueDate: task.dueDate, status: task.status };
}
