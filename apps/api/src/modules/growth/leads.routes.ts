import { idParamsSchema } from "@crm/contracts/growth";
import {
  createLeadRequestSchema,
  leadDetailResponseSchema,
  leadListQuerySchema,
  leadPageSchema,
  leadResponseSchema,
  reassignRequestSchema,
  reopenRequestSchema,
  stageMoveRequestSchema,
  updateLeadRequestSchema,
  type Lead,
  type StageChange,
} from "@crm/contracts/growth-leads";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import * as policy from "./growth.policy.js";
import type { LeadRow, StageChangeRow } from "./leads.repository.js";
import * as service from "./leads.service.js";

export interface LeadRouteOptions extends service.LeadDeps {
  requireUser: ReturnType<typeof requireSession>;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Explicit allowlist of lead response fields. */
export const leadBody = (row: LeadRow): Lead => ({
  id: row.id,
  name: row.name,
  companyId: row.companyId,
  primaryContactId: row.primaryContactId,
  source: row.source,
  sourceDetail: row.sourceDetail,
  ownerId: row.ownerId,
  ownerFlagged: row.ownerFlagged,
  stage: row.stage,
  stageRevision: row.stageRevision,
  priority: row.priority,
  estimatedValueMinor: row.estimatedValueMinor,
  currency: "INR",
  expectedCloseOn: row.expectedCloseOn,
  nextFollowUpOn: row.nextFollowUpOn,
  overdue: row.overdue,
  lostReason: row.lostReason,
  lostNote: row.lostNote,
  lostAt: iso(row.lostAt),
  version: row.version,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: iso(row.archivedAt),
  wonAt: iso(row.wonAt),
  wonVersionId: row.wonVersionId,
  wonAmountMinor: row.wonAmountMinor,
  wonCurrency: row.wonCurrency === null ? null : "INR",
});

const historyBody = (row: StageChangeRow): StageChange => ({
  id: row.id,
  fromStage: row.fromStage,
  toStage: row.toStage,
  stageRevision: row.stageRevision,
  actorId: row.actorId,
  note: row.note,
  lostReason: row.lostReason,
  createdAt: row.createdAt.toISOString(),
});

/** Repository convention: permission first (403), then a malformed id is reported as 404. */
export function idFrom(request: FastifyRequest, permission: (user: AuthSession["user"]) => void): string {
  permission(authOf(request).user);
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

/** Registered with the /api/v1/growth prefix. */
export function leadRoutes({ requireUser, ...deps }: LeadRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const one = (row: LeadRow) => toResponse(leadResponseSchema, { lead: leadBody(row) });
    /** 404 for an unknown well-formed id before the body is validated. */
    const exists = async (request: FastifyRequest, id: string) => {
      await service.getLead(deps, user(request), id);
    };

    app.get("/leads", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(leadListQuerySchema, request.query);
      const result = await service.listLeads(deps, user(request), query);
      return reply.code(200).send(toResponse(leadPageSchema, { items: result.items.map(leadBody), nextCursor: result.nextCursor }));
    });

    app.post("/leads", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createLeadRequestSchema, request.body);
      return reply.code(201).send(one(await service.createLead(deps, contextFrom(request), user(request), input)));
    });

    app.get("/leads/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      const detail = await service.getLead(deps, user(request), id);
      return reply
        .code(200)
        .send(toResponse(leadDetailResponseSchema, { lead: leadBody(detail.lead), history: detail.history.map(historyBody) }));
    });

    app.patch("/leads/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      await exists(request, id);
      const input = parseInput(updateLeadRequestSchema, request.body);
      return reply.code(200).send(one(await service.updateLead(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/leads/:id/stage", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      await exists(request, id);
      const input = parseInput(stageMoveRequestSchema, request.body);
      return reply.code(200).send(one(await service.moveStage(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/leads/:id/reopen", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanReopen);
      await exists(request, id);
      const input = parseInput(reopenRequestSchema, request.body);
      return reply.code(200).send(one(await service.reopenLead(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/leads/:id/reassign", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanReassign);
      await exists(request, id);
      const input = parseInput(reassignRequestSchema, request.body);
      return reply.code(200).send(one(await service.reassignLead(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/leads/:id/archive", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      return reply.code(200).send(one(await service.archiveLead(deps, contextFrom(request), user(request), id)));
    });

    done();
  };
}
