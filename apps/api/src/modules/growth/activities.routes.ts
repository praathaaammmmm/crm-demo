import {
  activityListQuerySchema,
  activityPageSchema,
  activityResponseSchema,
  logActivityRequestSchema,
  voidActivityRequestSchema,
  type Activity,
} from "@crm/contracts/growth-leads";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { ActivityRow } from "./activities.repository.js";
import * as service from "./activities.service.js";
import * as policy from "./growth.policy.js";
import { idFrom } from "./leads.routes.js";
import type { LeadDeps } from "./leads.service.js";

export interface ActivityRouteOptions extends LeadDeps {
  requireUser: ReturnType<typeof requireSession>;
}

/** Explicit allowlist of activity response fields. */
const activityBody = (row: ActivityRow): Activity => ({
  id: row.id,
  leadId: row.leadId,
  companyId: row.companyId,
  contactId: row.contactId,
  kind: row.kind,
  direction: row.direction,
  outcome: row.outcome,
  occurredAt: row.occurredAt.toISOString(),
  summary: row.summary,
  proofUrl: row.proofUrl,
  authorId: row.authorId,
  createdAt: row.createdAt.toISOString(),
  voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
  voidedBy: row.voidedBy,
  voidReason: row.voidReason,
});

/** Registered with the /api/v1/growth prefix. */
export function activityRoutes({ requireUser, ...deps }: ActivityRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const pageBody = (result: { items: ActivityRow[]; nextCursor: string | null }) =>
      toResponse(activityPageSchema, { items: result.items.map(activityBody), nextCursor: result.nextCursor });

    app.post("/activities", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(logActivityRequestSchema, request.body);
      const row = await service.logActivity(deps, contextFrom(request), user(request), input);
      return reply.code(201).send(toResponse(activityResponseSchema, { activity: activityBody(row) }));
    });

    app.post("/activities/:id/void", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const { reason } = parseInput(voidActivityRequestSchema, request.body);
      const row = await service.voidActivity(deps, contextFrom(request), user(request), id, reason);
      return reply.code(200).send(toResponse(activityResponseSchema, { activity: activityBody(row) }));
    });

    app.get("/leads/:id/activities", { preHandler: requireUser }, async (request, reply) => {
      const leadId = idFrom(request, policy.assertCanReadActivities);
      const query = parseInput(activityListQuerySchema, request.query);
      return reply.code(200).send(pageBody(await service.listForLead(deps, user(request), leadId, query)));
    });

    app.get("/companies/:id/activities", { preHandler: requireUser }, async (request, reply) => {
      const companyId = idFrom(request, policy.assertCanReadActivities);
      const query = parseInput(activityListQuerySchema, request.query);
      return reply.code(200).send(pageBody(await service.listForCompany(deps, user(request), companyId, query)));
    });

    done();
  };
}
