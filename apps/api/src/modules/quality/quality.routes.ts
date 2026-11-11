import { paginationQuerySchema } from "@crm/contracts/common";
import {
  createDefectRequestSchema,
  createQaCheckRequestSchema,
  defectDetailResponseSchema,
  defectListQuerySchema,
  defectPageSchema,
  defectResponseRequestSchema,
  defectResponseSchema,
  defectStatusRequestSchema,
  defectUpdateResponseSchema,
  idParamsSchema,
  qaCheckDetailResponseSchema,
  qaCheckListQuerySchema,
  qaCheckPageSchema,
  qaCheckResponseSchema,
  qaResultResponseSchema,
  qualitySummaryResponseSchema,
  readinessPageSchema,
  readinessResponseSchema,
  recordQaResultRequestSchema,
  setReadinessRequestSchema,
  updateDefectRequestSchema,
  type Defect,
  type DefectUpdate,
  type QaCheck,
  type QaResult,
  type ReadinessDecision,
} from "@crm/contracts/quality";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { DefectRow, DefectUpdateRow, QaCheckRow, QaResultRow, ReadinessRow } from "./quality.repository.js";
import * as service from "./quality.service.js";

export interface QualityRouteOptions extends service.QualityDeps {
  requireUser: ReturnType<typeof requireSession>;
}

// Explicit allowlists of response fields.

const iso = (date: Date | null) => (date ? date.toISOString() : null);

const qaCheckBody = (row: QaCheckRow): QaCheck => ({
  id: row.id,
  taskId: row.taskId,
  projectId: row.projectId,
  title: row.title,
  latestOutcome: row.latestOutcome,
  latestResultAt: iso(row.latestResultAt),
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const qaResultBody = (row: QaResultRow): QaResult => ({
  id: row.id,
  outcome: row.outcome,
  note: row.note,
  evidenceUrl: row.evidenceUrl,
  recordedBy: row.recordedBy,
  recordedAt: row.recordedAt.toISOString(),
});

const defectBody = (row: DefectRow): Defect => ({
  id: row.id,
  taskId: row.taskId,
  projectId: row.projectId,
  assigneeId: row.assigneeId,
  qaCheckId: row.qaCheckId,
  title: row.title,
  severity: row.severity,
  status: row.status,
  reproductionSteps: row.reproductionSteps,
  reportedBy: row.reportedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  resolvedAt: iso(row.resolvedAt),
});

const defectUpdateBody = (row: DefectUpdateRow): DefectUpdate => ({
  id: row.id,
  authorId: row.authorId,
  note: row.note,
  evidenceUrl: row.evidenceUrl,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  createdAt: row.createdAt.toISOString(),
});

const readinessBody = (row: ReadinessRow): ReadinessDecision => ({
  id: row.id,
  projectId: row.projectId,
  label: row.label,
  readiness: row.readiness,
  note: row.note,
  decidedBy: row.decidedBy,
  decidedAt: row.decidedAt.toISOString(),
});

/** A malformed id cannot name a record the caller may see, so it is reported as 404. */
function idFrom(request: FastifyRequest): string {
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

/** Registered with the /api/v1 prefix; paths below are full resource paths. */
export function qualityRoutes({ requireUser, ...deps }: QualityRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const oneDefect = (row: DefectRow) => toResponse(defectResponseSchema, { defect: defectBody(row) });

    app.get("/quality/summary", { preHandler: requireUser }, async (request, reply) => {
      return reply.code(200).send(toResponse(qualitySummaryResponseSchema, await service.qualitySummary(deps, user(request))));
    });

    // QA checks

    app.post("/tasks/:id/qa-checks", { preHandler: requireUser }, async (request, reply) => {
      const taskId = idFrom(request);
      const input = parseInput(createQaCheckRequestSchema, request.body);
      const row = await service.createQaCheck(deps, contextFrom(request), user(request), taskId, input);
      return reply.code(201).send(toResponse(qaCheckResponseSchema, { qaCheck: qaCheckBody(row) }));
    });

    app.get("/qa-checks", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(qaCheckListQuerySchema, request.query);
      const result = await service.listQaChecks(deps, user(request), query);
      return reply
        .code(200)
        .send(toResponse(qaCheckPageSchema, { items: result.items.map(qaCheckBody), nextCursor: result.nextCursor }));
    });

    app.get("/qa-checks/:id", { preHandler: requireUser }, async (request, reply) => {
      const detail = await service.getQaCheckDetail(deps, user(request), idFrom(request));
      return reply.code(200).send(
        toResponse(qaCheckDetailResponseSchema, {
          qaCheck: qaCheckBody(detail.qaCheck),
          results: detail.results.map(qaResultBody),
        }),
      );
    });

    app.post("/qa-checks/:id/results", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(recordQaResultRequestSchema, request.body);
      const recorded = await service.recordQaResult(deps, contextFrom(request), user(request), id, input);
      return reply.code(201).send(
        toResponse(qaResultResponseSchema, { qaCheck: qaCheckBody(recorded.qaCheck), result: qaResultBody(recorded.result) }),
      );
    });

    // Defects

    app.post("/tasks/:id/defects", { preHandler: requireUser }, async (request, reply) => {
      const taskId = idFrom(request);
      const input = parseInput(createDefectRequestSchema, request.body);
      return reply.code(201).send(oneDefect(await service.createDefect(deps, contextFrom(request), user(request), taskId, input)));
    });

    app.get("/defects", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(defectListQuerySchema, request.query);
      const result = await service.listDefects(deps, user(request), query);
      return reply
        .code(200)
        .send(toResponse(defectPageSchema, { items: result.items.map(defectBody), nextCursor: result.nextCursor }));
    });

    app.get("/defects/:id", { preHandler: requireUser }, async (request, reply) => {
      const detail = await service.getDefectDetail(deps, user(request), idFrom(request));
      return reply.code(200).send(
        toResponse(defectDetailResponseSchema, {
          defect: defectBody(detail.defect),
          updates: detail.updates.map(defectUpdateBody),
        }),
      );
    });

    app.patch("/defects/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(updateDefectRequestSchema, request.body);
      return reply.code(200).send(oneDefect(await service.updateDefect(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/defects/:id/status", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(defectStatusRequestSchema, request.body);
      return reply.code(200).send(oneDefect(await service.changeDefectStatus(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/defects/:id/updates", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(defectResponseRequestSchema, request.body);
      const row = await service.respondToDefect(deps, contextFrom(request), user(request), id, input);
      return reply.code(201).send(toResponse(defectUpdateResponseSchema, { update: defectUpdateBody(row) }));
    });

    // Release readiness

    app.post("/projects/:id/readiness", { preHandler: requireUser }, async (request, reply) => {
      const projectId = idFrom(request);
      const input = parseInput(setReadinessRequestSchema, request.body);
      const row = await service.setReadiness(deps, contextFrom(request), user(request), projectId, input);
      return reply.code(201).send(toResponse(readinessResponseSchema, { decision: readinessBody(row) }));
    });

    app.get("/projects/:id/readiness", { preHandler: requireUser }, async (request, reply) => {
      const projectId = idFrom(request);
      const query = parseInput(paginationQuerySchema, request.query);
      const result = await service.listReadiness(deps, user(request), projectId, query);
      return reply
        .code(200)
        .send(toResponse(readinessPageSchema, { items: result.items.map(readinessBody), nextCursor: result.nextCursor }));
    });

    done();
  };
}
