import {
  approvalIdParamsSchema,
  approvalListQuerySchema,
  approvalPageSchema,
  approvalResponseSchema,
  approveRequestSchema,
  createApprovalRequestSchema,
  rejectRequestSchema,
  type Approval,
} from "@crm/contracts/approvals";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { ApprovalRow } from "./approvals.repository.js";
import {
  approveRequest,
  cancelRequest,
  listApprovals,
  rejectRequest,
  requestApproval,
  type ApprovalDeps,
} from "./approvals.service.js";

export interface ApprovalRouteOptions extends ApprovalDeps {
  requireUser: ReturnType<typeof requireSession>;
}

/** Explicit allowlist of response fields. */
function approvalBody(row: ApprovalRow): Approval {
  return {
    id: row.id,
    type: row.type,
    targetUserId: row.targetUserId,
    payload: row.payload,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionNote: row.decisionNote,
  };
}

/** A malformed id cannot name a request the caller may see, so it is reported as 404. */
function idFrom(request: FastifyRequest): string {
  const result = approvalIdParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

export function approvalRoutes({ requireUser, ...deps }: ApprovalRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    app.post("/", { preHandler: requireUser }, async (request, reply) => {
      const input = parseInput(createApprovalRequestSchema, request.body);
      const row = await requestApproval(deps, contextFrom(request), authOf(request).user, input);
      return reply.code(201).send(toResponse(approvalResponseSchema, { approval: approvalBody(row) }));
    });

    app.get("/", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(approvalListQuerySchema, request.query);
      const page = await listApprovals(deps, authOf(request).user, query);
      return reply
        .code(200)
        .send(toResponse(approvalPageSchema, { items: page.items.map(approvalBody), nextCursor: page.nextCursor }));
    });

    app.post("/:id/approve", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const { note } = parseInput(approveRequestSchema, request.body ?? {});
      const row = await approveRequest(deps, contextFrom(request), authOf(request).user, id, note ?? null);
      return reply.code(200).send(toResponse(approvalResponseSchema, { approval: approvalBody(row) }));
    });

    app.post("/:id/reject", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const { note } = parseInput(rejectRequestSchema, request.body ?? {});
      const row = await rejectRequest(deps, contextFrom(request), authOf(request).user, id, note);
      return reply.code(200).send(toResponse(approvalResponseSchema, { approval: approvalBody(row) }));
    });

    app.post("/:id/cancel", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const row = await cancelRequest(deps, contextFrom(request), authOf(request).user, id);
      return reply.code(200).send(toResponse(approvalResponseSchema, { approval: approvalBody(row) }));
    });

    done();
  };
}
