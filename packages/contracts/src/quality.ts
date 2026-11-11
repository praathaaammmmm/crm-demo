import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

export const QA_OUTCOMES = ["passed", "failed", "blocked"] as const;
export const DEFECT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const DEFECT_STATUSES = ["open", "in_progress", "fixed", "verified", "wont_fix"] as const;
export const RELEASE_READINESS = ["not_ready", "at_risk", "ready"] as const;

export const qaOutcomeSchema = z.enum(QA_OUTCOMES);
export const defectSeveritySchema = z.enum(DEFECT_SEVERITIES);
export const defectStatusSchema = z.enum(DEFECT_STATUSES);
export const releaseReadinessSchema = z.enum(RELEASE_READINESS);

export type QaOutcome = z.infer<typeof qaOutcomeSchema>;
export type DefectSeverity = z.infer<typeof defectSeveritySchema>;
export type DefectStatus = z.infer<typeof defectStatusSchema>;
export type ReleaseReadiness = z.infer<typeof releaseReadinessSchema>;

/**
 * The single source of defect workflow rules, used by the API (with server-side policy, locking and
 * note enforcement) and by the web to decide which actions to show.
 */
export interface DefectWorkflow {
  statuses: Readonly<Record<DefectStatus, { label: string; final: boolean }>>;
  /** Moves the assignee of the linked task may make. */
  assigneeMoves: Readonly<Record<DefectStatus, readonly DefectStatus[]>>;
  /** Moves VP Engineering & Quality or the CEO/CTO may make (never on their own task). */
  managerMoves: Readonly<Record<DefectStatus, readonly DefectStatus[]>>;
  /** Moves into these statuses need a note; so does reopening a fixed defect. */
  noteRequiredTo: readonly DefectStatus[];
}

export const DEFECT_WORKFLOW: DefectWorkflow = {
  statuses: {
    open: { label: "Open", final: false },
    in_progress: { label: "In progress", final: false },
    fixed: { label: "Fixed", final: false },
    verified: { label: "Verified", final: true },
    wont_fix: { label: "Won't fix", final: true },
  },
  assigneeMoves: {
    open: ["in_progress"],
    in_progress: ["fixed"],
    fixed: [],
    verified: [],
    wont_fix: [],
  },
  managerMoves: {
    open: ["wont_fix"],
    in_progress: ["wont_fix"],
    fixed: ["verified", "open"],
    verified: [],
    wont_fix: [],
  },
  noteRequiredTo: ["fixed", "wont_fix"],
};

export const isFinalDefect = (status: DefectStatus): boolean => DEFECT_WORKFLOW.statuses[status].final;
export const canAssigneeMoveDefect = (from: DefectStatus, to: DefectStatus): boolean =>
  DEFECT_WORKFLOW.assigneeMoves[from].includes(to);
export const canManagerMoveDefect = (from: DefectStatus, to: DefectStatus): boolean =>
  DEFECT_WORKFLOW.managerMoves[from].includes(to);
export const defectMoveNeedsNote = (from: DefectStatus, to: DefectStatus): boolean =>
  DEFECT_WORKFLOW.noteRequiredTo.includes(to) || (from === "fixed" && to === "open");
export const defectStatusLabel = (status: DefectStatus): string => DEFECT_WORKFLOW.statuses[status].label;

const SEVERITY_LABELS: Record<DefectSeverity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const severityLabel = (severity: DefectSeverity): string => SEVERITY_LABELS[severity];
/** Critical and high defects block release readiness while they are not final. */
export const isBlockingSeverity = (severity: DefectSeverity): boolean => severity === "critical" || severity === "high";

const OUTCOME_LABELS: Record<QaOutcome, string> = { passed: "Passed", failed: "Failed", blocked: "Blocked" };
export const qaOutcomeLabel = (outcome: QaOutcome): string => OUTCOME_LABELS[outcome];
export const qaOutcomeNeedsNote = (outcome: QaOutcome): boolean => outcome !== "passed";

const READINESS_LABELS: Record<ReleaseReadiness, string> = { not_ready: "Not ready", at_risk: "At risk", ready: "Ready" };
export const readinessLabel = (readiness: ReleaseReadiness): string => READINESS_LABELS[readiness];
export const readinessNeedsNote = (readiness: ReleaseReadiness): boolean => readiness !== "ready";

const title = z.string().trim().min(1).max(200);
const shortNote = z.string().trim().min(1).max(2000);
const updateNote = z.string().trim().min(1).max(5000);
/** A syntactically valid https:// URL; stored and returned only, never fetched by the server. */
const evidenceUrl = z.url({ protocol: /^https$/ }).max(2000);

// QA checks

export const createQaCheckRequestSchema = z.strictObject({ title });
export type CreateQaCheckRequest = z.infer<typeof createQaCheckRequestSchema>;

export const recordQaResultRequestSchema = z
  .strictObject({ outcome: qaOutcomeSchema, note: shortNote.optional(), evidenceUrl: evidenceUrl.optional() })
  .refine((value) => !qaOutcomeNeedsNote(value.outcome) || value.note !== undefined, {
    message: "A note is required for failed or blocked results",
    path: ["note"],
  });
export type RecordQaResultRequest = z.infer<typeof recordQaResultRequestSchema>;

export const qaCheckListQuerySchema = paginationQuerySchema.extend({
  taskId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  outcome: qaOutcomeSchema.optional(),
});
export type QaCheckListQuery = z.infer<typeof qaCheckListQuerySchema>;

export const qaCheckSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  latestOutcome: qaOutcomeSchema.nullable(),
  latestResultAt: z.iso.datetime().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type QaCheck = z.infer<typeof qaCheckSchema>;

export const qaResultSchema = z.strictObject({
  id: z.uuid(),
  outcome: qaOutcomeSchema,
  note: z.string().nullable(),
  evidenceUrl: z.string().nullable(),
  recordedBy: z.uuid(),
  recordedAt: z.iso.datetime(),
});
export type QaResult = z.infer<typeof qaResultSchema>;

export const qaCheckResponseSchema = z.strictObject({ qaCheck: qaCheckSchema });
export const qaCheckDetailResponseSchema = z.strictObject({ qaCheck: qaCheckSchema, results: z.array(qaResultSchema) });
export type QaCheckDetail = z.infer<typeof qaCheckDetailResponseSchema>;
export const qaResultResponseSchema = z.strictObject({ qaCheck: qaCheckSchema, result: qaResultSchema });
export const qaCheckPageSchema = z.strictObject({ items: z.array(qaCheckSchema), nextCursor: nextCursorSchema });

// Defects

export const createDefectRequestSchema = z.strictObject({
  title,
  severity: defectSeveritySchema,
  reproductionSteps: z.string().trim().min(1).max(10000),
  qaCheckId: z.uuid().optional(),
});
export type CreateDefectRequest = z.infer<typeof createDefectRequestSchema>;

export const updateDefectRequestSchema = z
  .strictObject({
    title: title.optional(),
    severity: defectSeveritySchema.optional(),
    reproductionSteps: z.string().trim().min(1).max(10000).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateDefectRequest = z.infer<typeof updateDefectRequestSchema>;

/** Whether a note is required depends on the current status too, so the API checks it after locking. */
export const defectStatusRequestSchema = z.strictObject({ status: defectStatusSchema, note: updateNote.optional() });
export type DefectStatusRequest = z.infer<typeof defectStatusRequestSchema>;

export const defectResponseRequestSchema = z
  .strictObject({ note: updateNote.optional(), evidenceUrl: evidenceUrl.optional() })
  .refine((value) => value.note !== undefined || value.evidenceUrl !== undefined, { message: "Add a note or a link" });
export type DefectResponseRequest = z.infer<typeof defectResponseRequestSchema>;

export const defectListQuerySchema = paginationQuerySchema.extend({
  taskId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  status: defectStatusSchema.optional(),
  severity: defectSeveritySchema.optional(),
  open: z.enum(["true", "false"]).optional(),
});
export type DefectListQuery = z.infer<typeof defectListQuerySchema>;

export const defectSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  projectId: z.uuid(),
  /** The current assignee of the linked task, who responds to the defect. */
  assigneeId: z.uuid(),
  qaCheckId: z.uuid().nullable(),
  title: z.string(),
  severity: defectSeveritySchema,
  status: defectStatusSchema,
  reproductionSteps: z.string(),
  reportedBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type Defect = z.infer<typeof defectSchema>;

export const defectUpdateSchema = z.strictObject({
  id: z.uuid(),
  authorId: z.uuid(),
  note: z.string().nullable(),
  evidenceUrl: z.string().nullable(),
  fromStatus: defectStatusSchema.nullable(),
  toStatus: defectStatusSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type DefectUpdate = z.infer<typeof defectUpdateSchema>;

export const defectResponseSchema = z.strictObject({ defect: defectSchema });
export const defectDetailResponseSchema = z.strictObject({ defect: defectSchema, updates: z.array(defectUpdateSchema) });
export type DefectDetail = z.infer<typeof defectDetailResponseSchema>;
export const defectUpdateResponseSchema = z.strictObject({ update: defectUpdateSchema });
export const defectPageSchema = z.strictObject({ items: z.array(defectSchema), nextCursor: nextCursorSchema });

// Release readiness

export const setReadinessRequestSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(100),
    readiness: releaseReadinessSchema,
    note: shortNote.optional(),
  })
  .refine((value) => !readinessNeedsNote(value.readiness) || value.note !== undefined, {
    message: "A note is required unless the release is ready",
    path: ["note"],
  });
export type SetReadinessRequest = z.infer<typeof setReadinessRequestSchema>;

export const readinessDecisionSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  label: z.string(),
  readiness: releaseReadinessSchema,
  note: z.string().nullable(),
  decidedBy: z.uuid(),
  decidedAt: z.iso.datetime(),
});
export type ReadinessDecision = z.infer<typeof readinessDecisionSchema>;

export const readinessResponseSchema = z.strictObject({ decision: readinessDecisionSchema });
export const readinessPageSchema = z.strictObject({ items: z.array(readinessDecisionSchema), nextCursor: nextCursorSchema });

// Summary

/** Only the per-project rows are capped. */
export const QUALITY_PROJECT_ROW_CAP = 250;

const count = z.int().nonnegative();

export const qualityProjectRowSchema = z.strictObject({
  projectId: z.uuid(),
  name: z.string(),
  /** "not_ready" when the project has no readiness record. */
  readiness: releaseReadinessSchema,
  label: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  openCriticalDefects: count,
  openHighDefects: count,
  failedQaChecks: count,
  blockedQaChecks: count,
});
export type QualityProjectRow = z.infer<typeof qualityProjectRowSchema>;

export const qualitySummaryResponseSchema = z.strictObject({
  /** Exact and uncapped. */
  counts: z.strictObject({
    openCriticalDefects: count,
    openHighDefects: count,
    failedQaChecks: count,
    blockedQaChecks: count,
    projectsNotReady: count,
    projectsAtRisk: count,
  }),
  projects: z.array(qualityProjectRowSchema).max(QUALITY_PROJECT_ROW_CAP),
  capped: z.boolean(),
});
export type QualitySummary = z.infer<typeof qualitySummaryResponseSchema>;

export const idParamsSchema = z.strictObject({ id: z.uuid() });
