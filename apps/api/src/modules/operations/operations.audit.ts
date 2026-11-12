/**
 * Operations audit actions. Allowlisted fields only (docs/security/audit-policy.md): ids, statuses, severities,
 * environments, outcomes, counts and changed-field flags. Titles, notes, resolutions, summaries and error text
 * are never recorded.
 */
export const OPERATIONS_AUDIT = {
  incidentCreated: "operations.incident_created",
  incidentUpdated: "operations.incident_updated",
  incidentStatusChanged: "operations.incident_status_changed",
  incidentNoteAdded: "operations.incident_note_added",
  incidentPostNoteAdded: "operations.incident_post_note_added",
  releaseCreated: "operations.release_created",
  releaseUpdated: "operations.release_updated",
  releaseChecklistItemAdded: "operations.release_checklist_item_added",
  releaseChecklistItemChanged: "operations.release_checklist_item_changed",
  releaseStatusChanged: "operations.release_status_changed",
  automationCreated: "operations.automation_created",
  automationUpdated: "operations.automation_updated",
  automationStatusChanged: "operations.automation_status_changed",
  automationRunRecorded: "operations.automation_run_recorded",
} as const;

export function changedFlags<T extends Record<string, unknown>>(before: T, after: T, keys: readonly (keyof T & string)[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((key) => [`${key}Changed`, before[key] !== after[key]]));
}
