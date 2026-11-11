import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

// Must match the database enums (checked by apps/api/test/tasks-constraints.test.ts).
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "in_review", "changes_requested", "completed"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_REVIEW_DECISIONS = ["approved", "changes_requested", "marked_complete"] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

type ReviewDecision = "approved" | "changes_requested";

/**
 * The declarative task workflow shared by the API and the web app.
 * Display-level rules only: the API additionally enforces permissions, row locking, the
 * proof-before-submit rule and required notes (request schemas and database checks).
 */
export interface TaskWorkflow {
  /** Kanban column order. */
  columns: readonly TaskStatus[];
  statuses: Readonly<Record<TaskStatus, { label: string; open: boolean }>>;
  /** Direct status changes an assignee may make. Submit and review have their own rules below. */
  assigneeMoves: Readonly<Record<TaskStatus, readonly TaskStatus[]>>;
  submittableFrom: readonly TaskStatus[];
  reviewableFrom: readonly TaskStatus[];
  reviewOutcome: Readonly<Record<ReviewDecision, TaskStatus>>;
  /** Assignee moves for which a note must be collected. */
  noteRequiredOn: readonly TaskStatus[];
}

export const TASK_WORKFLOW: TaskWorkflow = {
  columns: TASK_STATUSES,
  statuses: {
    todo: { label: "Todo", open: true },
    in_progress: { label: "In progress", open: true },
    blocked: { label: "Blocked", open: true },
    in_review: { label: "In review", open: true },
    changes_requested: { label: "Changes requested", open: true },
    completed: { label: "Completed", open: false },
  },
  assigneeMoves: {
    todo: ["in_progress"],
    in_progress: ["blocked"],
    blocked: ["in_progress"],
    changes_requested: ["in_progress"],
    in_review: [],
    completed: [],
  },
  submittableFrom: ["in_progress", "changes_requested"],
  reviewableFrom: ["in_review"],
  reviewOutcome: { approved: "completed", changes_requested: "changes_requested" },
  noteRequiredOn: ["blocked"],
};

export const isOpenStatus = (status: TaskStatus): boolean => TASK_WORKFLOW.statuses[status].open;
export const canAssigneeMove = (from: TaskStatus, to: TaskStatus): boolean =>
  TASK_WORKFLOW.assigneeMoves[from].includes(to);
export const canSubmitFrom = (status: TaskStatus): boolean => TASK_WORKFLOW.submittableFrom.includes(status);
export const canReviewFrom = (status: TaskStatus): boolean => TASK_WORKFLOW.reviewableFrom.includes(status);
export const canCompleteFrom = (status: TaskStatus): boolean => isOpenStatus(status);
export const statusLabel = (status: TaskStatus): string => TASK_WORKFLOW.statuses[status].label;

const title = z.string().trim().min(1).max(200);
const description = z.string().trim().max(10000);
const updateNote = z.string().trim().min(1).max(5000);
const shortNote = z.string().trim().min(1).max(2000);
/** A syntactically valid https:// URL; stored and returned only, never fetched by the server. */
const proofUrl = z.url({ protocol: /^https$/ }).max(2000);

export const createTaskRequestSchema = z.strictObject({
  projectId: z.uuid(),
  title,
  description: description.default(""),
  priority: taskPrioritySchema,
  dueDate: z.iso.date(),
  assigneeId: z.uuid(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: z.iso.date().optional(),
    assigneeId: z.uuid().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

/** Status changes an assignee may make directly. Submitting for review has its own endpoint. */
export const statusChangeRequestSchema = z
  .strictObject({ status: z.enum(["in_progress", "blocked"]), note: updateNote.optional() })
  .refine((value) => value.status !== "blocked" || value.note !== undefined, {
    message: "A note is required when marking a task blocked",
    path: ["note"],
  });
export type StatusChangeRequest = z.infer<typeof statusChangeRequestSchema>;

export const progressNoteRequestSchema = z.strictObject({ note: updateNote });

export const proofRequestSchema = z
  .strictObject({ url: proofUrl.optional(), note: shortNote.optional() })
  .refine((value) => value.url !== undefined || value.note !== undefined, { message: "Add a link or a note" });
export type ProofRequest = z.infer<typeof proofRequestSchema>;

export const submitRequestSchema = z.strictObject({ note: updateNote.optional() });

export const reviewRequestSchema = z
  .strictObject({ decision: z.enum(["approved", "changes_requested"]), note: shortNote.optional() })
  .refine((value) => value.decision !== "changes_requested" || value.note !== undefined, {
    message: "A note is required when requesting changes",
    path: ["note"],
  });
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

export const completeRequestSchema = z.strictObject({ note: shortNote.optional() });

export const taskListQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid().optional(),
  status: taskStatusSchema.optional(),
  overdue: z.enum(["true", "false"]).optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskIdParamsSchema = z.strictObject({ id: z.uuid() });

export const taskSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  description: z.string(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  dueDate: z.iso.date(),
  assigneeId: z.uuid(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  overdue: z.boolean(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskUpdateSchema = z.strictObject({
  id: z.uuid(),
  authorId: z.uuid(),
  fromStatus: taskStatusSchema.nullable(),
  toStatus: taskStatusSchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const taskProofSchema = z.strictObject({
  id: z.uuid(),
  authorId: z.uuid(),
  url: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const taskReviewSchema = z.strictObject({
  id: z.uuid(),
  reviewerId: z.uuid(),
  decision: z.enum(TASK_REVIEW_DECISIONS),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const taskResponseSchema = z.strictObject({ task: taskSchema });

export const taskDetailResponseSchema = z.strictObject({
  task: taskSchema,
  updates: z.array(taskUpdateSchema),
  proofs: z.array(taskProofSchema),
  reviews: z.array(taskReviewSchema),
});

export type TaskDetail = z.infer<typeof taskDetailResponseSchema>;

export const taskPageSchema = z.strictObject({ items: z.array(taskSchema), nextCursor: nextCursorSchema });

export const taskUpdateResponseSchema = z.strictObject({ update: taskUpdateSchema });
export const taskProofResponseSchema = z.strictObject({ proof: taskProofSchema });

export const taskSummarySchema = z.strictObject({
  overdue: z.number().int().min(0),
  blocked: z.number().int().min(0),
  pendingReview: z.number().int().min(0),
  completed: z.number().int().min(0),
});
