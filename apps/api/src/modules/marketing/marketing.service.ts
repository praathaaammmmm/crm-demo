import {
  campaignAcceptsContent,
  CAMPAIGN_STATUSES,
  canMoveCampaign,
  canMoveContent,
  CONTENT_STATUSES,
  MARKETING_CHANNELS,
  type AddAssetLinkRequest,
  type CampaignListQuery,
  type CampaignOutcome,
  type CampaignStatus,
  type ContentListQuery,
  type ContentOutcomeRequest,
  type ContentStatusRequest,
  type CreateCampaignRequest,
  type CreateContentRequest,
  type MarketingSummary,
  type UpdateCampaignRequest,
  type UpdateContentRequest,
} from "@crm/contracts/marketing";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Executor, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { defined } from "../../platform/defined.js";
import { guardedTransaction, pageOf } from "../../platform/transactions.js";
import { recordAudit } from "../audit/index.js";
import { changedFlags, MARKETING_AUDIT } from "./marketing.audit.js";
import * as policy from "./marketing.policy.js";
import * as repo from "./marketing.repository.js";
import type { AssetRow, CampaignRow, ContentRow } from "./marketing.repository.js";

type User = AuthSession["user"];

export interface MarketingDeps {
  db: Database;
  /** Defines "today" for overdue and upcoming content. */
  orgTimezone: string;
}

const CAMPAIGN_FIELDS = ["name", "objective", "startsOn", "endsOn"] as const;
const CONTENT_FIELDS = ["title", "campaignId", "plannedFor", "brief"] as const;

const assertCampaignOpen = (campaign: CampaignRow) => {
  if (campaign.status === "completed" || campaign.status === "cancelled") throw errors.conflict("A finished campaign is read-only");
};

const assertContentEditable = (content: ContentRow) => {
  if (content.status === "published" || content.status === "cancelled") throw errors.conflict("Published or cancelled content is read-only");
};

/** A linked campaign must exist and still accept content. */
async function assertCampaignLink(db: Executor, campaignId: string | null | undefined): Promise<void> {
  if (campaignId === undefined || campaignId === null) return;
  const campaign = await repo.findCampaign(db, campaignId);
  if (!campaign) throw errors.conflict("The campaign does not exist");
  if (!campaignAcceptsContent(campaign.status)) throw errors.conflict("Content cannot join a finished campaign");
}

async function lockCampaign(tx: Tx, id: string): Promise<CampaignRow> {
  const campaign = await repo.lockCampaign(tx, id);
  if (!campaign) throw errors.notFound();
  return campaign;
}

async function lockContent(tx: Tx, id: string, timeZone: string): Promise<ContentRow> {
  const content = await repo.lockContent(tx, id, timeZone);
  if (!content) throw errors.notFound();
  return content;
}

async function reloadCampaign(tx: Tx, id: string): Promise<CampaignRow> {
  const campaign = await repo.findCampaign(tx, id);
  if (!campaign) throw new Error("Campaign not found after change");
  return campaign;
}

async function reloadContent(tx: Tx, id: string, timeZone: string): Promise<ContentRow> {
  const content = await repo.findContent(tx, id, timeZone);
  if (!content) throw new Error("Content not found after change");
  return content;
}

// Campaigns

export async function listCampaigns(deps: MarketingDeps, user: User, query: CampaignListQuery) {
  policy.assertCanRead(user);
  return pageOf(await repo.listCampaigns(deps.db, { status: query.status, cursor: query.cursor, limit: query.limit }), query.limit);
}

export async function getCampaign(deps: MarketingDeps, user: User, id: string): Promise<{ campaign: CampaignRow; outcome: CampaignOutcome }> {
  policy.assertCanRead(user);
  const campaign = await repo.findCampaign(deps.db, id);
  if (!campaign) throw errors.notFound();
  const raw = await repo.campaignOutcome(deps.db, id, deps.orgTimezone);
  const outcome: CampaignOutcome = {
    contentByStatus: CONTENT_STATUSES.map((status) => ({ status, count: raw.byStatus.find((row) => row.status === status)?.count ?? 0 })),
    byChannel: MARKETING_CHANNELS.map((channel) => {
      const row = raw.byChannel.find((item) => item.channel === channel);
      return { channel, published: row?.published ?? 0, reach: row?.reach ?? 0, engagements: row?.engagements ?? 0, clicks: row?.clicks ?? 0 };
    }),
    publishedOnTime: raw.onTime,
    publishedLate: raw.late,
  };
  return { campaign, outcome };
}

/** CMO only. */
export async function createCampaign(deps: MarketingDeps, ctx: Ctx, user: User, input: CreateCampaignRequest): Promise<CampaignRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const id = await repo.insertCampaign(tx, {
      name: input.name,
      objective: input.objective ?? null,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      createdBy: user.id,
    });
    const campaign = await reloadCampaign(tx, id);
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.campaignCreated,
      entityType: "marketing_campaign",
      entityId: id,
      after: { status: campaign.status, startsOn: campaign.startsOn, endsOn: campaign.endsOn },
    });
    return campaign;
  });
}

export async function updateCampaign(deps: MarketingDeps, ctx: Ctx, user: User, id: string, input: UpdateCampaignRequest): Promise<CampaignRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockCampaign(tx, id);
    assertCampaignOpen(before);
    const startsOn = input.startsOn === undefined ? before.startsOn : input.startsOn;
    const endsOn = input.endsOn === undefined ? before.endsOn : input.endsOn;
    if (startsOn !== null && endsOn !== null && startsOn > endsOn) throw errors.validation("The end date must be on or after the start date");
    await repo.updateCampaign(tx, id, defined(input));
    const after = await reloadCampaign(tx, id);
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.campaignUpdated,
      entityType: "marketing_campaign",
      entityId: id,
      before: { startsOn: before.startsOn, endsOn: before.endsOn },
      after: { startsOn: after.startsOn, endsOn: after.endsOn, ...changedFlags(before, after, CAMPAIGN_FIELDS) },
    });
    return after;
  });
}

export async function moveCampaign(deps: MarketingDeps, ctx: Ctx, user: User, id: string, to: CampaignStatus): Promise<CampaignRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockCampaign(tx, id);
    if (!canMoveCampaign(before.status, to)) throw errors.conflict("This campaign cannot move to that status");
    await repo.updateCampaign(tx, id, { status: to });
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.campaignStatusChanged,
      entityType: "marketing_campaign",
      entityId: id,
      before: { status: before.status },
      after: { status: to },
    });
    return reloadCampaign(tx, id);
  });
}

// Content

export async function listContent(deps: MarketingDeps, user: User, query: ContentListQuery) {
  policy.assertCanRead(user);
  const rows = await repo.listContent(
    deps.db,
    { channel: query.channel, status: query.status, campaignId: query.campaignId, from: query.from, to: query.to, cursor: query.cursor, limit: query.limit },
    deps.orgTimezone,
  );
  return pageOf(rows, query.limit);
}

export async function getContent(deps: MarketingDeps, user: User, id: string): Promise<{ content: ContentRow; assets: AssetRow[] }> {
  policy.assertCanRead(user);
  const content = await repo.findContent(deps.db, id, deps.orgTimezone);
  if (!content) throw errors.notFound();
  return { content, assets: await repo.listAssets(deps.db, id) };
}

const contentSnapshot = (content: ContentRow) => ({
  status: content.status,
  channel: content.channel,
  campaignId: content.campaignId,
  plannedFor: content.plannedFor,
});

export async function createContent(deps: MarketingDeps, ctx: Ctx, user: User, input: CreateContentRequest): Promise<ContentRow> {
  policy.assertCanManage(user);
  await assertCampaignLink(deps.db, input.campaignId);
  return guardedTransaction(deps.db, async (tx) => {
    const id = await repo.insertContent(tx, {
      title: input.title,
      channel: input.channel,
      campaignId: input.campaignId ?? null,
      plannedFor: input.plannedFor ?? null,
      brief: input.brief ?? null,
      createdBy: user.id,
    });
    const content = await reloadContent(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, { action: MARKETING_AUDIT.contentCreated, entityType: "marketing_content", entityId: id, after: contentSnapshot(content) });
    return content;
  });
}

export async function updateContent(deps: MarketingDeps, ctx: Ctx, user: User, id: string, input: UpdateContentRequest): Promise<ContentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockContent(tx, id, deps.orgTimezone);
    assertContentEditable(before);
    if (input.campaignId !== undefined && input.campaignId !== before.campaignId) await assertCampaignLink(tx, input.campaignId);
    await repo.updateContent(tx, id, defined(input));
    const after = await reloadContent(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.contentUpdated,
      entityType: "marketing_content",
      entityId: id,
      before: contentSnapshot(before),
      after: { ...contentSnapshot(after), ...changedFlags(before, after, CONTENT_FIELDS) },
    });
    return after;
  });
}

/** Publishing stores the proof link and time together; published and cancelled are final. */
export async function moveContent(deps: MarketingDeps, ctx: Ctx, user: User, id: string, input: ContentStatusRequest): Promise<ContentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockContent(tx, id, deps.orgTimezone);
    if (!canMoveContent(before.status, input.to)) throw errors.conflict("This content cannot move to that status");
    if (input.to === "published") {
      if (input.proofUrl === undefined) throw errors.validation("Publishing needs a proof link");
      await repo.publishContent(tx, id, input.proofUrl);
    } else {
      await repo.updateContent(tx, id, { status: input.to });
    }
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.contentStatusChanged,
      entityType: "marketing_content",
      entityId: id,
      before: { status: before.status },
      after: { status: input.to, proofRecorded: input.to === "published" },
    });
    return reloadContent(tx, id, deps.orgTimezone);
  });
}

export async function recordOutcome(deps: MarketingDeps, ctx: Ctx, user: User, id: string, input: ContentOutcomeRequest): Promise<ContentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockContent(tx, id, deps.orgTimezone);
    if (before.status !== "published") throw errors.conflict("Outcomes are recorded for published content only");
    await repo.updateContent(tx, id, defined(input));
    const after = await reloadContent(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.contentOutcomeRecorded,
      entityType: "marketing_content",
      entityId: id,
      before: { reach: before.reach, engagements: before.engagements, clicks: before.clicks },
      after: { reach: after.reach, engagements: after.engagements, clicks: after.clicks },
    });
    return after;
  });
}

// Asset links

export async function addAsset(deps: MarketingDeps, ctx: Ctx, user: User, contentId: string, input: AddAssetLinkRequest): Promise<AssetRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const content = await lockContent(tx, contentId, deps.orgTimezone);
    if (content.status === "cancelled") throw errors.conflict("Cancelled content is read-only");
    const asset = await repo.insertAsset(tx, { contentId, label: input.label, url: input.url, kind: input.kind, createdBy: user.id });
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.assetAdded,
      entityType: "marketing_asset_link",
      entityId: asset.id,
      after: { contentId, kind: asset.kind },
    });
    return asset;
  });
}

export async function removeAsset(deps: MarketingDeps, ctx: Ctx, user: User, id: string): Promise<AssetRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const asset = await repo.findAsset(tx, id);
    if (!asset) throw errors.notFound();
    if (asset.removedAt !== null) throw errors.conflict("This link is already removed");
    const removed = await repo.removeAsset(tx, id, user.id);
    await recordAudit(tx, ctx, {
      action: MARKETING_AUDIT.assetRemoved,
      entityType: "marketing_asset_link",
      entityId: id,
      before: { removed: false },
      after: { contentId: asset.contentId, removed: true },
    });
    return removed;
  });
}

// Dashboard

export async function summary(deps: MarketingDeps, user: User): Promise<MarketingSummary> {
  policy.assertCanRead(user);
  const raw = await repo.summary(deps.db, deps.orgTimezone);
  return {
    today: raw.today,
    campaignsByStatus: CAMPAIGN_STATUSES.map((status) => ({ status, count: raw.campaigns.find((row) => row.status === status)?.count ?? 0 })),
    contentByStatus: CONTENT_STATUSES.map((status) => ({ status, count: raw.content.find((row) => row.status === status)?.count ?? 0 })),
    upcoming: raw.upcoming,
    overdue: raw.overdue,
    inReview: raw.inReview,
    last30Days: MARKETING_CHANNELS.map((channel) => {
      const row = raw.recent.find((item) => item.channel === channel);
      return { channel, published: row?.published ?? 0, reach: row?.reach ?? 0, engagements: row?.engagements ?? 0, clicks: row?.clicks ?? 0 };
    }),
  };
}
