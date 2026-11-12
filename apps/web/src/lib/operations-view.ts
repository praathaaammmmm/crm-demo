import {
  automationNoteRequired,
  automationTransition,
  AUTOMATION_STATUSES,
  INCIDENT_TRANSITIONS,
  releaseNoteRequired,
  releaseTransition,
  RELEASE_STATUSES,
  type AutomationHealth,
  type AutomationStatus,
  type IncidentSeverity,
  type IncidentStatus,
  type ReleaseEnvironment,
  type ReleaseStatus,
} from "@crm/contracts/operations";

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = { sev1: "SEV 1", sev2: "SEV 2", sev3: "SEV 3", sev4: "SEV 4" };
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  mitigated: "Mitigated",
  resolved: "Resolved",
};
export const ENVIRONMENT_LABELS: Record<ReleaseEnvironment, string> = { staging: "Staging", production: "Production" };
export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  deployed: "Deployed",
  failed: "Failed",
  rolled_back: "Rolled back",
};
export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  draft: "Draft",
  testing: "Testing",
  awaiting_approval: "Awaiting approval",
  live: "Live",
  paused: "Paused",
  retired: "Retired",
};
export const HEALTH_LABELS: Record<AutomationHealth, string> = { unknown: "No runs yet", healthy: "Healthy", degraded: "Degraded", failing: "Failing" };

export interface Viewer {
  manage: boolean;
  approve: boolean;
}

export interface WorkflowAction<S extends string> {
  to: S;
  label: string;
  needsNote: boolean;
  danger: boolean;
}

/** Incident moves other than resolving, which has its own form. */
export const incidentMoveTargets = (status: IncidentStatus): IncidentStatus[] => INCIDENT_TRANSITIONS[status].filter((to) => to !== "resolved");

const RELEASE_ACTION_LABELS: Partial<Record<ReleaseStatus, string>> = {
  awaiting_approval: "Submit for approval",
  approved: "Approve",
  rejected: "Reject",
  draft: "Back to draft",
  deployed: "Record deployed",
  failed: "Record failed",
  rolled_back: "Record rollback",
};

/** The release actions this viewer may take now, from the shared workflow rule. */
export function releaseActions(environment: ReleaseEnvironment, status: ReleaseStatus, viewer: Viewer): WorkflowAction<ReleaseStatus>[] {
  return RELEASE_STATUSES.flatMap((to) => {
    const actor = releaseTransition(environment, status, to);
    if (actor === null || (actor === "approver" ? !viewer.approve : !viewer.manage)) return [];
    return [{ to, label: RELEASE_ACTION_LABELS[to] ?? to, needsNote: releaseNoteRequired(to), danger: to === "rejected" || to === "rolled_back" || to === "failed" }];
  });
}

const AUTOMATION_ACTION_LABELS: Record<AutomationStatus, string> = {
  draft: "Back to draft",
  testing: "Start testing",
  awaiting_approval: "Request go-live",
  live: "Go live",
  paused: "Pause",
  retired: "Retire",
};

export function automationActions(status: AutomationStatus, viewer: Viewer): WorkflowAction<AutomationStatus>[] {
  return AUTOMATION_STATUSES.flatMap((to) => {
    const actor = automationTransition(status, to);
    if (actor === null || (actor === "approver" ? !viewer.approve : !viewer.manage)) return [];
    const needsNote = automationNoteRequired(status, to);
    const label = status === "awaiting_approval" ? (to === "live" ? "Approve go-live" : "Send back to testing") : status === "paused" && to === "live" ? "Resume" : AUTOMATION_ACTION_LABELS[to];
    return [{ to, label, needsNote, danger: to === "retired" || needsNote }];
  });
}
