import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

/** Marketing (Phase 4B, ADR 0011): campaigns, a content calendar and link-only assets. No uploads or external APIs. */

export const MARKETING_CHANNELS = ["linkedin", "instagram", "youtube"] as const;
export const CONTENT_STATUSES = ["draft", "planned", "in_review", "published", "cancelled"] as const;
export const CAMPAIGN_STATUSES = ["draft", "planned", "active", "paused", "completed", "cancelled"] as const;
export const ASSET_KINDS = ["image", "video", "document", "design", "other"] as const;

export const marketingChannelSchema = z.enum(MARKETING_CHANNELS);
export const contentStatusSchema = z.enum(CONTENT_STATUSES);
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export const assetKindSchema = z.enum(ASSET_KINDS);

export type MarketingChannel = z.infer<typeof marketingChannelSchema>;
export type ContentStatus = z.infer<typeof contentStatusSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type AssetKind = z.infer<typeof assetKindSchema>;

/** The single source of status rules; the database enforces the same pairs (migration 0018). */
export const CONTENT_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["draft", "in_review", "cancelled"],
  in_review: ["planned", "published", "cancelled"],
  published: [],
  cancelled: [],
};

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["draft", "active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const canMoveContent = (from: ContentStatus, to: ContentStatus): boolean => CONTENT_TRANSITIONS[from].includes(to);
export const canMoveCampaign = (from: CampaignStatus, to: CampaignStatus): boolean => CAMPAIGN_TRANSITIONS[from].includes(to);
/** Content may only join a campaign that has not finished. */
export const campaignAcceptsContent = (status: CampaignStatus): boolean => status !== "completed" && status !== "cancelled";

/** Largest recorded outcome count per content item. */
export const MAX_OUTCOME = 1_000_000_000;

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
const name = z.string().transform(normalize).pipe(z.string().min(1).max(200));
const text = (max: number) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(max));
const isoDate = z.iso.date();
export const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);
const outcome = z.int().min(0).max(MAX_OUTCOME);

// Campaigns

export const createCampaignRequestSchema = z
  .strictObject({ name, objective: text(1000).optional(), startsOn: isoDate.optional(), endsOn: isoDate.optional() })
  .refine((v) => v.startsOn === undefined || v.endsOn === undefined || v.startsOn <= v.endsOn, {
    message: "The end date must be on or after the start date",
    path: ["endsOn"],
  });
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

/** `null` clears an optional field. */
export const updateCampaignRequestSchema = z
  .strictObject({ name: name.optional(), objective: text(1000).nullable().optional(), startsOn: isoDate.nullable().optional(), endsOn: isoDate.nullable().optional() })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;

export const campaignStatusRequestSchema = z.strictObject({ to: campaignStatusSchema });

export const campaignListQuerySchema = paginationQuerySchema.extend({ status: campaignStatusSchema.optional() });
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;

export const campaignSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  objective: z.string().nullable(),
  status: campaignStatusSchema,
  startsOn: isoDate.nullable(),
  endsOn: isoDate.nullable(),
  contentCount: z.int().nonnegative(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Campaign = z.infer<typeof campaignSchema>;

/** Outcome from internal records only: content progress and the reach/engagement/click counts the CMO recorded. */
export const campaignOutcomeSchema = z.strictObject({
  contentByStatus: z.array(z.strictObject({ status: contentStatusSchema, count: z.int().nonnegative() })),
  byChannel: z.array(
    z.strictObject({
      channel: marketingChannelSchema,
      published: z.int().nonnegative(),
      reach: z.int().nonnegative(),
      engagements: z.int().nonnegative(),
      clicks: z.int().nonnegative(),
    }),
  ),
  publishedOnTime: z.int().nonnegative(),
  publishedLate: z.int().nonnegative(),
});
export type CampaignOutcome = z.infer<typeof campaignOutcomeSchema>;

export const campaignResponseSchema = z.strictObject({ campaign: campaignSchema });
export const campaignDetailResponseSchema = z.strictObject({ campaign: campaignSchema, outcome: campaignOutcomeSchema });
export type CampaignDetail = z.infer<typeof campaignDetailResponseSchema>;
export const campaignPageSchema = z.strictObject({ items: z.array(campaignSchema), nextCursor: nextCursorSchema });

// Content

export const createContentRequestSchema = z.strictObject({
  title: name,
  channel: marketingChannelSchema,
  campaignId: z.uuid().optional(),
  plannedFor: isoDate.optional(),
  brief: text(2000).optional(),
});
export type CreateContentRequest = z.infer<typeof createContentRequestSchema>;

export const updateContentRequestSchema = z
  .strictObject({
    title: name.optional(),
    campaignId: z.uuid().nullable().optional(),
    plannedFor: isoDate.nullable().optional(),
    brief: text(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateContentRequest = z.infer<typeof updateContentRequestSchema>;

/** Publishing needs an HTTPS proof link to the live post; no other status takes one. */
export const contentStatusRequestSchema = z
  .strictObject({ to: contentStatusSchema, proofUrl: httpsUrl.optional() })
  .refine((v) => (v.to === "published") === (v.proofUrl !== undefined), {
    message: "Publishing needs an https:// proof link, and only publishing takes one",
    path: ["proofUrl"],
  });
export type ContentStatusRequest = z.infer<typeof contentStatusRequestSchema>;

/** Recorded by the CMO for published content only. */
export const contentOutcomeRequestSchema = z
  .strictObject({ reach: outcome.optional(), engagements: outcome.optional(), clicks: outcome.optional() })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: "Nothing to update" });
export type ContentOutcomeRequest = z.infer<typeof contentOutcomeRequestSchema>;

export const contentListQuerySchema = paginationQuerySchema
  .extend({
    channel: marketingChannelSchema.optional(),
    status: contentStatusSchema.optional(),
    campaignId: z.uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, { message: "The start date must be on or before the end date", path: ["from"] });
export type ContentListQuery = z.infer<typeof contentListQuerySchema>;

export const contentSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  channel: marketingChannelSchema,
  status: contentStatusSchema,
  campaignId: z.uuid().nullable(),
  plannedFor: isoDate.nullable(),
  brief: z.string().nullable(),
  proofUrl: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  reach: z.int().nonnegative().nullable(),
  engagements: z.int().nonnegative().nullable(),
  clicks: z.int().nonnegative().nullable(),
  /** Planned before today (org time zone) and not yet published or cancelled. */
  overdue: z.boolean(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Content = z.infer<typeof contentSchema>;

// Asset links: metadata only, the server never fetches them.

export const addAssetLinkRequestSchema = z.strictObject({ label: name, url: httpsUrl, kind: assetKindSchema });
export type AddAssetLinkRequest = z.infer<typeof addAssetLinkRequestSchema>;

export const assetLinkSchema = z.strictObject({
  id: z.uuid(),
  contentId: z.uuid(),
  label: z.string(),
  url: z.string(),
  kind: assetKindSchema,
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  removedAt: z.iso.datetime().nullable(),
});
export type AssetLink = z.infer<typeof assetLinkSchema>;

export const contentResponseSchema = z.strictObject({ content: contentSchema });
export const contentDetailResponseSchema = z.strictObject({ content: contentSchema, assets: z.array(assetLinkSchema) });
export type ContentDetail = z.infer<typeof contentDetailResponseSchema>;
export const contentPageSchema = z.strictObject({ items: z.array(contentSchema), nextCursor: nextCursorSchema });
export const assetLinkResponseSchema = z.strictObject({ asset: assetLinkSchema });

// Dashboard

export const marketingSummarySchema = z.strictObject({
  today: isoDate,
  campaignsByStatus: z.array(z.strictObject({ status: campaignStatusSchema, count: z.int().nonnegative() })),
  contentByStatus: z.array(z.strictObject({ status: contentStatusSchema, count: z.int().nonnegative() })),
  /** Draft, planned or in review with a planned date in the next 14 days (today included). */
  upcoming: z.int().nonnegative(),
  overdue: z.int().nonnegative(),
  inReview: z.int().nonnegative(),
  /** Published in the last 30 days, by channel, with the outcomes recorded for them. */
  last30Days: z.array(
    z.strictObject({
      channel: marketingChannelSchema,
      published: z.int().nonnegative(),
      reach: z.int().nonnegative(),
      engagements: z.int().nonnegative(),
      clicks: z.int().nonnegative(),
    }),
  ),
});
export type MarketingSummary = z.infer<typeof marketingSummarySchema>;

export const idParamsSchema = z.strictObject({ id: z.uuid() });
