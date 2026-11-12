import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

/**
 * Engineering Operations (Phase 4C, ADR 0012): incidents, release records and an automation registry.
 * Records only: nothing here deploys, runs or calls anything.
 */

export const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;
export const INCIDENT_STATUSES = ["open", "investigating", "mitigated", "resolved"] as const;
export const RELEASE_ENVIRONMENTS = ["staging", "production"] as const;
export const RELEASE_STATUSES = ["draft", "awaiting_approval", "approved", "rejected", "deployed", "failed", "rolled_back"] as const;
export const AUTOMATION_STATUSES = ["draft", "testing", "awaiting_approval", "live", "paused", "retired"] as const;
export const RUN_OUTCOMES = ["succeeded", "failed"] as const;
export const AUTOMATION_HEALTH = ["unknown", "healthy", "degraded", "failing"] as const;

export const incidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);
export const releaseEnvironmentSchema = z.enum(RELEASE_ENVIRONMENTS);
export const releaseStatusSchema = z.enum(RELEASE_STATUSES);
export const automationStatusSchema = z.enum(AUTOMATION_STATUSES);
export const runOutcomeSchema = z.enum(RUN_OUTCOMES);
export const automationHealthSchema = z.enum(AUTOMATION_HEALTH);

export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type ReleaseEnvironment = z.infer<typeof releaseEnvironmentSchema>;
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;
export type AutomationStatus = z.infer<typeof automationStatusSchema>;
export type AutomationHealth = z.infer<typeof automationHealthSchema>;

// Workflow rules (single source; the database enforces the same pairs in migration 0020).

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["investigating", "mitigated", "resolved"],
  investigating: ["mitigated", "resolved"],
  mitigated: ["investigating", "resolved"],
  resolved: [],
};
export const canMoveIncident = (from: IncidentStatus, to: IncidentStatus): boolean => INCIDENT_TRANSITIONS[from].includes(to);

/** Who may make a release transition: the VP records the work; the CEO/CTO decides production approval. */
export type ReleaseActor = "manager" | "approver";

/**
 * Release transitions by environment. Production: draft → awaiting_approval → approved (CEO) → deployed/failed.
 * Staging needs no approval: draft → deployed/failed. A rollback record closes a deployed or failed release.
 */
export function releaseTransition(env: ReleaseEnvironment, from: ReleaseStatus, to: ReleaseStatus): ReleaseActor | null {
  const key = `${from}>${to}`;
  if (env === "production") {
    if (key === "draft>awaiting_approval" || key === "rejected>draft") return "manager";
    if (key === "awaiting_approval>approved" || key === "awaiting_approval>rejected") return "approver";
    if (key === "approved>deployed" || key === "approved>failed") return "manager";
  } else if (key === "draft>deployed" || key === "draft>failed") {
    return "manager";
  }
  if (key === "deployed>rolled_back" || key === "failed>rolled_back") return "manager";
  return null;
}
/** A note is required for rejection and for the rollback record. */
export const releaseNoteRequired = (to: ReleaseStatus): boolean => to === "rejected" || to === "rolled_back";
/** Checklist items can be added or ticked only while the release is a draft. */
export const releaseEditable = (status: ReleaseStatus): boolean => status === "draft";

export function automationTransition(from: AutomationStatus, to: AutomationStatus): ReleaseActor | null {
  const key = `${from}>${to}`;
  if (key === "awaiting_approval>live" || key === "awaiting_approval>testing") return "approver";
  if (["draft>testing", "testing>draft", "testing>awaiting_approval", "live>paused", "paused>live"].includes(key)) return "manager";
  if (to === "retired" && from !== "retired") return "manager";
  return null;
}
/** Sending an automation back from approval needs a note. */
export const automationNoteRequired = (from: AutomationStatus, to: AutomationStatus): boolean => from === "awaiting_approval" && to === "testing";
export const automationEditable = (status: AutomationStatus): boolean => status === "draft" || status === "testing";
/** Runs are recorded while an automation is being tested or is in service. */
export const automationAcceptsRuns = (status: AutomationStatus): boolean => status === "testing" || status === "live" || status === "paused";

/** Health from the five most recent runs. */
export function automationHealth(recent: readonly ("succeeded" | "failed")[]): AutomationHealth {
  if (recent.length === 0) return "unknown";
  if (recent[0] === "failed") return "failing";
  return recent.slice(0, 5).includes("failed") ? "degraded" : "healthy";
}

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
const name = z.string().transform(normalize).pipe(z.string().min(1).max(200));
const text = (max: number) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(max));
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

/**
 * Error summaries are short, human-written and safe: no URLs, connection strings, key/value secrets or stack traces.
 * The refusal message never echoes the input.
 */
const UNSAFE_SUMMARY = /(:\/\/|\b(password|passwd|secret|token|api[_-]?key|authorization|bearer)\b|\bat\s+\S+\s*\(|\n)/i;
export const isSafeSummary = (value: string): boolean => !UNSAFE_SUMMARY.test(value);
const errorSummary = text(300).refine(isSafeSummary, "Keep the summary short and free of links, secrets and stack traces");

// Incidents

export const createIncidentRequestSchema = z.strictObject({
  title: name,
  severity: incidentSeveritySchema,
  ownerId: z.uuid(),
  summary: text(2000).optional(),
  startedAt: isoDateTime.optional(),
});
export type CreateIncidentRequest = z.infer<typeof createIncidentRequestSchema>;

export const updateIncidentRequestSchema = z
  .strictObject({ title: name.optional(), severity: incidentSeveritySchema.optional(), ownerId: z.uuid().optional(), summary: text(2000).nullable().optional() })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateIncidentRequest = z.infer<typeof updateIncidentRequestSchema>;

export const incidentStatusRequestSchema = z
  .strictObject({ to: incidentStatusSchema, note: text(2000).optional(), resolution: text(2000).optional() })
  .refine((v) => (v.to === "resolved") === (v.resolution !== undefined), {
    message: "Resolving needs a resolution summary, and only resolving takes one",
    path: ["resolution"],
  });
export type IncidentStatusRequest = z.infer<typeof incidentStatusRequestSchema>;

export const incidentNoteRequestSchema = z.strictObject({ note: text(2000) });
export const postIncidentRequestSchema = z.strictObject({ note: text(5000) });

export const incidentListQuerySchema = paginationQuerySchema.extend({
  status: incidentStatusSchema.optional(),
  severity: incidentSeveritySchema.optional(),
  open: z.enum(["true", "false"]).optional(),
});
export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;

export const incidentSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  severity: incidentSeveritySchema,
  status: incidentStatusSchema,
  ownerId: z.uuid(),
  summary: z.string().nullable(),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolution: z.string().nullable(),
  postIncidentNote: z.string().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const incidentUpdateSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["note", "status"]),
  fromStatus: incidentStatusSchema.nullable(),
  toStatus: incidentStatusSchema.nullable(),
  note: z.string().nullable(),
  actorId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type IncidentUpdate = z.infer<typeof incidentUpdateSchema>;

export const incidentResponseSchema = z.strictObject({ incident: incidentSchema });
export const incidentDetailResponseSchema = z.strictObject({ incident: incidentSchema, timeline: z.array(incidentUpdateSchema) });
export type IncidentDetail = z.infer<typeof incidentDetailResponseSchema>;
export const incidentPageSchema = z.strictObject({ items: z.array(incidentSchema), nextCursor: nextCursorSchema });

// Releases

export const createReleaseRequestSchema = z.strictObject({
  name,
  versionLabel: z.string().transform(normalize).pipe(z.string().min(1).max(64)),
  environment: releaseEnvironmentSchema,
  plannedFor: isoDate.optional(),
  notes: text(2000).optional(),
});
export type CreateReleaseRequest = z.infer<typeof createReleaseRequestSchema>;

export const updateReleaseRequestSchema = z
  .strictObject({
    name: name.optional(),
    versionLabel: z.string().transform(normalize).pipe(z.string().min(1).max(64)).optional(),
    plannedFor: isoDate.nullable().optional(),
    notes: text(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateReleaseRequest = z.infer<typeof updateReleaseRequestSchema>;

export const releaseDecisionRequestSchema = z.strictObject({ to: releaseStatusSchema, note: text(2000).optional() });
export type ReleaseDecisionRequest = z.infer<typeof releaseDecisionRequestSchema>;

export const addChecklistItemRequestSchema = z.strictObject({ label: name });
export const checklistItemRequestSchema = z.strictObject({ done: z.boolean() });

export const releaseListQuerySchema = paginationQuerySchema.extend({
  status: releaseStatusSchema.optional(),
  environment: releaseEnvironmentSchema.optional(),
});
export type ReleaseListQuery = z.infer<typeof releaseListQuerySchema>;

export const releaseSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  versionLabel: z.string(),
  environment: releaseEnvironmentSchema,
  status: releaseStatusSchema,
  plannedFor: isoDate.nullable(),
  notes: z.string().nullable(),
  checklistTotal: z.int().nonnegative(),
  checklistDone: z.int().nonnegative(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Release = z.infer<typeof releaseSchema>;

export const checklistItemSchema = z.strictObject({
  id: z.uuid(),
  label: z.string(),
  done: z.boolean(),
  doneBy: z.uuid().nullable(),
  doneAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/** Append-only: every status change, including approval decisions and the rollback record. */
export const releaseDecisionSchema = z.strictObject({
  id: z.uuid(),
  fromStatus: releaseStatusSchema,
  toStatus: releaseStatusSchema,
  note: z.string().nullable(),
  actorId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ReleaseDecision = z.infer<typeof releaseDecisionSchema>;

export const releaseResponseSchema = z.strictObject({ release: releaseSchema });
export const releaseDetailResponseSchema = z.strictObject({
  release: releaseSchema,
  checklist: z.array(checklistItemSchema),
  decisions: z.array(releaseDecisionSchema),
});
export type ReleaseDetail = z.infer<typeof releaseDetailResponseSchema>;
export const releasePageSchema = z.strictObject({ items: z.array(releaseSchema), nextCursor: nextCursorSchema });
export const checklistItemResponseSchema = z.strictObject({ item: checklistItemSchema });

// Automations

export const createAutomationRequestSchema = z.strictObject({ name, purpose: text(1000), trigger: text(200) });
export type CreateAutomationRequest = z.infer<typeof createAutomationRequestSchema>;

export const updateAutomationRequestSchema = z
  .strictObject({ name: name.optional(), purpose: text(1000).optional(), trigger: text(200).optional() })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateAutomationRequest = z.infer<typeof updateAutomationRequestSchema>;

export const automationStatusRequestSchema = z.strictObject({ to: automationStatusSchema, note: text(1000).optional() });
export type AutomationStatusRequest = z.infer<typeof automationStatusRequestSchema>;

export const recordRunRequestSchema = z
  .strictObject({ startedAt: isoDateTime, finishedAt: isoDateTime, outcome: runOutcomeSchema, errorSummary: errorSummary.optional() })
  .refine((v) => Date.parse(v.finishedAt) >= Date.parse(v.startedAt), { message: "A run cannot finish before it starts", path: ["finishedAt"] })
  .refine((v) => (v.outcome === "failed") === (v.errorSummary !== undefined), {
    message: "A failed run needs a short error summary, and only a failed run takes one",
    path: ["errorSummary"],
  });
export type RecordRunRequest = z.infer<typeof recordRunRequestSchema>;

export const automationListQuerySchema = paginationQuerySchema.extend({ status: automationStatusSchema.optional() });
export type AutomationListQuery = z.infer<typeof automationListQuerySchema>;

export const automationSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  purpose: z.string(),
  trigger: z.string(),
  status: automationStatusSchema,
  health: automationHealthSchema,
  lastRunAt: z.iso.datetime().nullable(),
  failuresLast30Days: z.int().nonnegative(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationRunSchema = z.strictObject({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  outcome: runOutcomeSchema,
  errorSummary: z.string().nullable(),
  recordedBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const automationChangeSchema = z.strictObject({
  id: z.uuid(),
  fromStatus: automationStatusSchema,
  toStatus: automationStatusSchema,
  note: z.string().nullable(),
  actorId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type AutomationChange = z.infer<typeof automationChangeSchema>;

export const automationResponseSchema = z.strictObject({ automation: automationSchema });
export const automationDetailResponseSchema = z.strictObject({
  automation: automationSchema,
  runs: z.array(automationRunSchema),
  changes: z.array(automationChangeSchema),
});
export type AutomationDetail = z.infer<typeof automationDetailResponseSchema>;
export const automationPageSchema = z.strictObject({ items: z.array(automationSchema), nextCursor: nextCursorSchema });
export const automationRunResponseSchema = z.strictObject({ run: automationRunSchema });

// Dashboard

export const operationsSummarySchema = z.strictObject({
  openIncidentsBySeverity: z.array(z.strictObject({ severity: incidentSeveritySchema, count: z.int().nonnegative() })),
  incidentsResolvedLast30Days: z.int().nonnegative(),
  releasesByStatus: z.array(z.strictObject({ status: releaseStatusSchema, count: z.int().nonnegative() })),
  releasesAwaitingApproval: z.int().nonnegative(),
  /** Outcomes recorded in the last 30 days. */
  deploymentsLast30Days: z.strictObject({ deployed: z.int().nonnegative(), failed: z.int().nonnegative(), rolledBack: z.int().nonnegative() }),
  automationsByStatus: z.array(z.strictObject({ status: automationStatusSchema, count: z.int().nonnegative() })),
  automationsAwaitingApproval: z.int().nonnegative(),
  /** Live automations whose health is degraded or failing. */
  unhealthyLiveAutomations: z.int().nonnegative(),
});
export type OperationsSummary = z.infer<typeof operationsSummarySchema>;

export const idParamsSchema = z.strictObject({ id: z.uuid() });
