import { idParamsSchema } from "@crm/contracts/growth";
import {
  acceptanceRequestSchema,
  createVersionRequestSchema,
  markWonRequestSchema,
  proposalDetailSchema,
  proposalListQuerySchema,
  proposalPageSchema,
  proposalResponseSchema,
  versionActionRequestSchema,
  versionNoteRequestSchema,
  type Proposal,
} from "@crm/contracts/growth-proposals";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import * as policy from "./growth.policy.js";
import type { AcceptanceRow, ProposalRow } from "./proposals.repository.js";
import * as service from "./proposals.service.js";

export interface ProposalRouteOptions extends service.ProposalDeps { requireUser: ReturnType<typeof requireSession> }

const proposalBody = (row: ProposalRow): Proposal => {
  if (row.status === null || row.currentVersionId === null || row.currentVersionNo === null) throw new Error("Proposal cache is incomplete");
  return { id: row.id, leadId: row.leadId, leadName: row.leadName, ownerId: row.ownerId, status: row.status, currentVersionId: row.currentVersionId,
    currentVersionNo: row.currentVersionNo, amountMinor: row.amountMinor, currency: "INR", validUntil: row.validUntil,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
};
const confirmationBody = (row: AcceptanceRow) => {
  if (row.decision === null) return null;
  if (row.decidedBy === null || row.decidedAt === null) throw new Error("Confirmation is incomplete");
  return { decision: row.decision, note: row.decisionNote, actorId: row.decidedBy, createdAt: row.decidedAt.toISOString() };
};
const id = (request: FastifyRequest, check: (user: ReturnType<typeof authOf>["user"]) => void) => {
  check(authOf(request).user);
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
};

export function proposalRoutes({ requireUser, ...deps }: ProposalRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const one = (row: ProposalRow) => toResponse(proposalResponseSchema, { proposal: proposalBody(row) });
    const page = (result: { items: ProposalRow[]; nextCursor: string | null }) =>
      toResponse(proposalPageSchema, { items: result.items.map(proposalBody), nextCursor: result.nextCursor });
    app.get("/proposals", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(proposalListQuerySchema, request.query);
      return reply.code(200).send(page(await service.list(deps, user(request), query)));
    });
    app.get("/proposals/queue", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanApproveProposals(user(request));
      const query = parseInput(proposalListQuerySchema, request.query);
      return reply.code(200).send(page(await service.queue(deps, user(request), query)));
    });
    app.get("/leads/:id/proposal", { preHandler: requireUser }, async (request, reply) => {
      const leadId = id(request, policy.assertCanRead); const detail = await service.detail(deps, user(request), leadId);
      return reply.code(200).send(toResponse(proposalDetailSchema, {
        proposal: detail.proposal === null ? null : proposalBody(detail.proposal),
        versions: detail.versions.map((v) => ({ ...v, status: v.status, currency: "INR" as const, createdAt: v.createdAt.toISOString() })),
        events: detail.events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
        acceptances: detail.acceptances.map((a) => ({ id: a.id, versionNo: a.versionNo, method: a.method, evidenceUrl: a.evidenceUrl, note: a.note,
          acceptedOn: a.acceptedOn, late: a.late, needsConfirmation: a.needsConfirmation, recordedBy: a.recordedBy, recordedAt: a.recordedAt.toISOString(),
          confirmation: confirmationBody(a) })),
      }));
    });
    app.post("/leads/:id/proposal/versions", { preHandler: requireUser }, async (request, reply) => {
      const leadId = id(request, policy.assertCanManage); const input = parseInput(createVersionRequestSchema, request.body);
      return reply.code(201).send(one(await service.createVersion(deps, contextFrom(request), user(request), leadId, input)));
    });
    const action = (path: string, schema: typeof versionActionRequestSchema | typeof versionNoteRequestSchema, fn: (proposalId: string, request: FastifyRequest, input: never) => Promise<ProposalRow>, check: (u: ReturnType<typeof authOf>["user"]) => void) => {
      app.post(path, { preHandler: requireUser }, async (request, reply) => { const proposalId = id(request, check); const input = parseInput(schema, request.body); return reply.code(200).send(one(await fn(proposalId, request, input as never))); });
    };
    action("/proposals/:id/submit", versionActionRequestSchema, (proposalId,r,input) => service.submit(deps,contextFrom(r),user(r),proposalId,input), policy.assertCanManage);
    action("/proposals/:id/approve", versionActionRequestSchema, (proposalId,r,input) => service.approve(deps,contextFrom(r),user(r),proposalId,input), policy.assertCanApproveProposals);
    action("/proposals/:id/reject", versionNoteRequestSchema, (proposalId,r,input) => service.reject(deps,contextFrom(r),user(r),proposalId,input), policy.assertCanApproveProposals);
    action("/proposals/:id/sent", versionActionRequestSchema, (proposalId,r,input) => service.send(deps,contextFrom(r),user(r),proposalId,input), policy.assertCanManage);
    action("/proposals/:id/withdraw", versionNoteRequestSchema, (proposalId,r,input) => service.withdraw(deps,contextFrom(r),user(r),proposalId,input), policy.assertCanManage);
    action("/proposals/:id/confirm", versionActionRequestSchema, (proposalId,r,input) => service.confirm(deps,contextFrom(r),user(r),proposalId,input,"confirmed"), policy.assertCanApproveProposals);
    action("/proposals/:id/refuse", versionNoteRequestSchema, (proposalId,r,input) => service.confirm(deps,contextFrom(r),user(r),proposalId,input,"refused"), policy.assertCanApproveProposals);
    app.post("/proposals/:id/acceptance", { preHandler: requireUser }, async (request, reply) => { const proposalId=id(request,policy.assertCanManage); const input=parseInput(acceptanceRequestSchema,request.body); return reply.code(200).send(one(await service.accept(deps,contextFrom(request),user(request),proposalId,input))); });
    app.post("/leads/:id/won", { preHandler: requireUser }, async (request, reply) => { const leadId=id(request,policy.assertCanManage); const input=parseInput(markWonRequestSchema,request.body); return reply.code(200).send(one(await service.markWon(deps,contextFrom(request),user(request),leadId,input.versionNo))); });
    done();
  };
}
