import {
  addAssetLinkRequestSchema,
  assetLinkResponseSchema,
  campaignDetailResponseSchema,
  campaignListQuerySchema,
  campaignPageSchema,
  campaignResponseSchema,
  campaignStatusRequestSchema,
  contentDetailResponseSchema,
  contentListQuerySchema,
  contentOutcomeRequestSchema,
  contentPageSchema,
  contentResponseSchema,
  contentStatusRequestSchema,
  createCampaignRequestSchema,
  createContentRequestSchema,
  idParamsSchema,
  marketingSummarySchema,
  updateCampaignRequestSchema,
  updateContentRequestSchema,
  type AssetLink,
  type Campaign,
  type Content,
} from "@crm/contracts/marketing";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import * as policy from "./marketing.policy.js";
import type { AssetRow, CampaignRow, ContentRow } from "./marketing.repository.js";
import * as service from "./marketing.service.js";

export interface MarketingRouteOptions extends service.MarketingDeps {
  requireUser: ReturnType<typeof requireSession>;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

// Explicit allowlists of response fields.

const campaignBody = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  objective: row.objective,
  status: row.status,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  contentCount: row.contentCount,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const contentBody = (row: ContentRow): Content => ({
  id: row.id,
  title: row.title,
  channel: row.channel,
  status: row.status,
  campaignId: row.campaignId,
  plannedFor: row.plannedFor,
  brief: row.brief,
  proofUrl: row.proofUrl,
  publishedAt: iso(row.publishedAt),
  reach: row.reach,
  engagements: row.engagements,
  clicks: row.clicks,
  overdue: row.overdue,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const assetBody = (row: AssetRow): AssetLink => ({
  id: row.id,
  contentId: row.contentId,
  label: row.label,
  url: row.url,
  kind: row.kind,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  removedAt: iso(row.removedAt),
});

/** Permission first (403), then a malformed id is reported as 404, like an unknown one. */
function idFrom(request: FastifyRequest, permission: (user: AuthSession["user"]) => void): string {
  permission(authOf(request).user);
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

/** Registered with the /api/v1/marketing prefix. */
export function marketingRoutes({ requireUser, ...deps }: MarketingRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const campaign = (row: CampaignRow) => toResponse(campaignResponseSchema, { campaign: campaignBody(row) });
    const content = (row: ContentRow) => toResponse(contentResponseSchema, { content: contentBody(row) });
    const asset = (row: AssetRow) => toResponse(assetLinkResponseSchema, { asset: assetBody(row) });

    app.get("/summary", { preHandler: requireUser }, async (request, reply) => {
      return reply.code(200).send(toResponse(marketingSummarySchema, await service.summary(deps, user(request))));
    });

    app.get("/campaigns", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(campaignListQuerySchema, request.query);
      const result = await service.listCampaigns(deps, user(request), query);
      return reply.code(200).send(toResponse(campaignPageSchema, { items: result.items.map(campaignBody), nextCursor: result.nextCursor }));
    });

    app.post("/campaigns", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createCampaignRequestSchema, request.body);
      return reply.code(201).send(campaign(await service.createCampaign(deps, contextFrom(request), user(request), input)));
    });

    app.get("/campaigns/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      const detail = await service.getCampaign(deps, user(request), id);
      return reply.code(200).send(toResponse(campaignDetailResponseSchema, { campaign: campaignBody(detail.campaign), outcome: detail.outcome }));
    });

    app.patch("/campaigns/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(updateCampaignRequestSchema, request.body);
      return reply.code(200).send(campaign(await service.updateCampaign(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/campaigns/:id/status", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const { to } = parseInput(campaignStatusRequestSchema, request.body);
      return reply.code(200).send(campaign(await service.moveCampaign(deps, contextFrom(request), user(request), id, to)));
    });

    app.get("/content", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(contentListQuerySchema, request.query);
      const result = await service.listContent(deps, user(request), query);
      return reply.code(200).send(toResponse(contentPageSchema, { items: result.items.map(contentBody), nextCursor: result.nextCursor }));
    });

    app.post("/content", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createContentRequestSchema, request.body);
      return reply.code(201).send(content(await service.createContent(deps, contextFrom(request), user(request), input)));
    });

    app.get("/content/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      const detail = await service.getContent(deps, user(request), id);
      return reply.code(200).send(toResponse(contentDetailResponseSchema, { content: contentBody(detail.content), assets: detail.assets.map(assetBody) }));
    });

    app.patch("/content/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(updateContentRequestSchema, request.body);
      return reply.code(200).send(content(await service.updateContent(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/content/:id/status", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(contentStatusRequestSchema, request.body);
      return reply.code(200).send(content(await service.moveContent(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/content/:id/outcome", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(contentOutcomeRequestSchema, request.body);
      return reply.code(200).send(content(await service.recordOutcome(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/content/:id/assets", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(addAssetLinkRequestSchema, request.body);
      return reply.code(201).send(asset(await service.addAsset(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/assets/:id/remove", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      return reply.code(200).send(asset(await service.removeAsset(deps, contextFrom(request), user(request), id)));
    });

    done();
  };
}
