import {
  completeRequestSchema,
  createTaskRequestSchema,
  progressNoteRequestSchema,
  proofRequestSchema,
  reviewRequestSchema,
  statusChangeRequestSchema,
  submitRequestSchema,
  taskDetailResponseSchema,
  taskIdParamsSchema,
  taskListQuerySchema,
  taskPageSchema,
  taskProofResponseSchema,
  taskResponseSchema,
  taskSummarySchema,
  taskUpdateResponseSchema,
  updateTaskRequestSchema,
  type Task,
} from "@crm/contracts/tasks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { TaskProofRow, TaskReviewRow, TaskRow, TaskUpdateRow } from "./tasks.repository.js";
import {
  addProgressNote,
  addProof,
  changeStatus,
  createTask,
  getTaskDetail,
  listTasks,
  markComplete,
  reviewTask,
  submitForReview,
  taskSummary,
  updateTask,
  type TaskDeps,
} from "./tasks.service.js";

export interface TaskRouteOptions extends TaskDeps {
  requireUser: ReturnType<typeof requireSession>;
}

// Explicit allowlists of response fields.

const taskBody = (row: TaskRow): Task => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  description: row.description,
  priority: row.priority,
  status: row.status,
  dueDate: row.dueDate,
  assigneeId: row.assigneeId,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  overdue: row.overdue,
});

const updateBody = (row: TaskUpdateRow) => ({
  id: row.id,
  authorId: row.authorId,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

const proofBody = (row: TaskProofRow) => ({
  id: row.id,
  authorId: row.authorId,
  url: row.url,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

const reviewBody = (row: TaskReviewRow) => ({
  id: row.id,
  reviewerId: row.reviewerId,
  decision: row.decision,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

/** A malformed id cannot name a task the caller may see, so it is reported as 404. */
function idFrom(request: FastifyRequest): string {
  const result = taskIdParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

export function taskRoutes({ requireUser, ...deps }: TaskRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const one = (row: TaskRow) => toResponse(taskResponseSchema, { task: taskBody(row) });

    app.post("/", { preHandler: requireUser }, async (request, reply) => {
      const input = parseInput(createTaskRequestSchema, request.body);
      return reply.code(201).send(one(await createTask(deps, contextFrom(request), user(request), input)));
    });

    app.get("/", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(taskListQuerySchema, request.query);
      const page = await listTasks(deps, user(request), query);
      return reply.code(200).send(toResponse(taskPageSchema, { items: page.items.map(taskBody), nextCursor: page.nextCursor }));
    });

    // Registered before "/:id" for clarity; Fastify matches the static path first either way.
    app.get("/summary", { preHandler: requireUser }, async (request, reply) => {
      return reply.code(200).send(toResponse(taskSummarySchema, await taskSummary(deps, user(request))));
    });

    app.get("/:id", { preHandler: requireUser }, async (request, reply) => {
      const detail = await getTaskDetail(deps, user(request), idFrom(request));
      return reply.code(200).send(
        toResponse(taskDetailResponseSchema, {
          task: taskBody(detail.task),
          updates: detail.updates.map(updateBody),
          proofs: detail.proofs.map(proofBody),
          reviews: detail.reviews.map(reviewBody),
        }),
      );
    });

    app.patch("/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(updateTaskRequestSchema, request.body);
      return reply.code(200).send(one(await updateTask(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/:id/status", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(statusChangeRequestSchema, request.body);
      return reply.code(200).send(one(await changeStatus(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/:id/updates", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const { note } = parseInput(progressNoteRequestSchema, request.body);
      const row = await addProgressNote(deps, contextFrom(request), user(request), id, note);
      return reply.code(201).send(toResponse(taskUpdateResponseSchema, { update: updateBody(row) }));
    });

    app.post("/:id/proofs", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(proofRequestSchema, request.body);
      const row = await addProof(deps, contextFrom(request), user(request), id, input);
      return reply.code(201).send(toResponse(taskProofResponseSchema, { proof: proofBody(row) }));
    });

    app.post("/:id/submit", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const { note } = parseInput(submitRequestSchema, request.body ?? {});
      return reply.code(200).send(one(await submitForReview(deps, contextFrom(request), user(request), id, note)));
    });

    app.post("/:id/review", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(reviewRequestSchema, request.body);
      return reply.code(200).send(one(await reviewTask(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/:id/complete", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const { note } = parseInput(completeRequestSchema, request.body ?? {});
      return reply.code(200).send(one(await markComplete(deps, contextFrom(request), user(request), id, note)));
    });

    done();
  };
}
