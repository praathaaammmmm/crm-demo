import type { CampaignStatus, ContentStatus, MarketingChannel } from "@crm/contracts/marketing";
import { marketingAssetLinks, marketingCampaigns, marketingContent } from "@crm/database/schema";
import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

/** "Today" in the organisation's time zone, computed by the database. */
const today = (timeZone: string) => sql`(now() AT TIME ZONE ${timeZone})::date`;
const UNFINISHED = sql`('draft', 'planned', 'in_review')`;

const campaignColumns = {
  id: marketingCampaigns.id,
  name: marketingCampaigns.name,
  objective: marketingCampaigns.objective,
  status: marketingCampaigns.status,
  startsOn: marketingCampaigns.startsOn,
  endsOn: marketingCampaigns.endsOn,
  // Outer columns are table-qualified so the correlated subquery cannot bind them to the inner table.
  contentCount: sql<number>`(SELECT count(*)::int FROM marketing_content c WHERE c.campaign_id = marketing_campaigns.id)`,
  createdBy: marketingCampaigns.createdBy,
  createdAt: marketingCampaigns.createdAt,
  updatedAt: marketingCampaigns.updatedAt,
};

const contentColumns = (timeZone: string) => ({
  id: marketingContent.id,
  title: marketingContent.title,
  channel: marketingContent.channel,
  status: marketingContent.status,
  campaignId: marketingContent.campaignId,
  plannedFor: marketingContent.plannedFor,
  brief: marketingContent.brief,
  proofUrl: marketingContent.proofUrl,
  publishedAt: marketingContent.publishedAt,
  reach: marketingContent.reach,
  engagements: marketingContent.engagements,
  clicks: marketingContent.clicks,
  overdue: sql<boolean>`(marketing_content.status IN ${UNFINISHED} AND marketing_content.planned_for IS NOT NULL
    AND marketing_content.planned_for < ${today(timeZone)})`,
  createdBy: marketingContent.createdBy,
  createdAt: marketingContent.createdAt,
  updatedAt: marketingContent.updatedAt,
});

export type CampaignRow = NonNullable<Awaited<ReturnType<typeof findCampaign>>>;
export type ContentRow = NonNullable<Awaited<ReturnType<typeof findContent>>>;
export type AssetRow = typeof marketingAssetLinks.$inferSelect;

/**
 * Inserts are raw SQL with explicit column lists: crm_app has INSERT on these columns only (migration 0019), and a
 * Drizzle insert names every column (sending DEFAULT for the rest), which the column grants refuse.
 */
function insertedId(rows: { id: string }[], what: string): string {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`${what} insert returned no row`);
  return id;
}

// Campaigns

export async function findCampaign(db: Executor, id: string) {
  const rows = await db.select(campaignColumns).from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockCampaign(tx: Tx, id: string) {
  const rows = await tx.select(campaignColumns).from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export function listCampaigns(db: Executor, filter: { status: CampaignStatus | undefined; cursor: string | undefined; limit: number }) {
  const conditions: SQL[] = [];
  if (filter.status !== undefined) conditions.push(eq(marketingCampaigns.status, filter.status));
  if (filter.cursor !== undefined) conditions.push(sql`${marketingCampaigns.id} > ${filter.cursor}`);
  return db
    .select(campaignColumns)
    .from(marketingCampaigns)
    .where(and(...conditions))
    .orderBy(asc(marketingCampaigns.id))
    .limit(filter.limit + 1);
}

export async function insertCampaign(
  tx: Tx,
  input: { name: string; objective: string | null; startsOn: string | null; endsOn: string | null; createdBy: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO marketing_campaigns (name, objective, starts_on, ends_on, created_by)
    VALUES (${input.name}, ${input.objective}, ${input.startsOn}::date, ${input.endsOn}::date, ${input.createdBy})
    RETURNING id
  `);
  return insertedId(result.rows, "Campaign");
}

export async function updateCampaign(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof marketingCampaigns.$inferInsert, "name" | "objective" | "startsOn" | "endsOn" | "status">>,
): Promise<void> {
  await tx
    .update(marketingCampaigns)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(marketingCampaigns.id, id));
}

/** Outcome from internal records only (ADR 0011). */
export async function campaignOutcome(db: Executor, campaignId: string, timeZone: string) {
  const byStatus = await db.execute<{ status: ContentStatus; count: number }>(sql`
    SELECT status, count(*)::int AS count FROM marketing_content WHERE campaign_id = ${campaignId} GROUP BY status
  `);
  const byChannel = await db.execute<{ channel: MarketingChannel; published: number; reach: number; engagements: number; clicks: number }>(sql`
    SELECT channel,
           count(*)::int AS published,
           coalesce(sum(reach), 0)::float8 AS reach,
           coalesce(sum(engagements), 0)::float8 AS engagements,
           coalesce(sum(clicks), 0)::float8 AS clicks
      FROM marketing_content
     WHERE campaign_id = ${campaignId} AND status = 'published'
     GROUP BY channel
  `);
  const timing = await db.execute<{ on_time: number; late: number }>(sql`
    SELECT count(*) FILTER (WHERE planned_for IS NULL OR (published_at AT TIME ZONE ${timeZone})::date <= planned_for)::int AS on_time,
           count(*) FILTER (WHERE planned_for IS NOT NULL AND (published_at AT TIME ZONE ${timeZone})::date > planned_for)::int AS late
      FROM marketing_content
     WHERE campaign_id = ${campaignId} AND status = 'published'
  `);
  return { byStatus: byStatus.rows, byChannel: byChannel.rows, onTime: timing.rows[0]?.on_time ?? 0, late: timing.rows[0]?.late ?? 0 };
}

// Content

export async function findContent(db: Executor, id: string, timeZone: string) {
  const rows = await db.select(contentColumns(timeZone)).from(marketingContent).where(eq(marketingContent.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockContent(tx: Tx, id: string, timeZone: string) {
  const rows = await tx.select(contentColumns(timeZone)).from(marketingContent).where(eq(marketingContent.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export function listContent(
  db: Executor,
  filter: {
    channel: MarketingChannel | undefined;
    status: ContentStatus | undefined;
    campaignId: string | undefined;
    from: string | undefined;
    to: string | undefined;
    cursor: string | undefined;
    limit: number;
  },
  timeZone: string,
) {
  const conditions: SQL[] = [];
  if (filter.channel !== undefined) conditions.push(eq(marketingContent.channel, filter.channel));
  if (filter.status !== undefined) conditions.push(eq(marketingContent.status, filter.status));
  if (filter.campaignId !== undefined) conditions.push(eq(marketingContent.campaignId, filter.campaignId));
  if (filter.from !== undefined) conditions.push(gte(marketingContent.plannedFor, filter.from));
  if (filter.to !== undefined) conditions.push(lte(marketingContent.plannedFor, filter.to));
  if (filter.cursor !== undefined) conditions.push(sql`${marketingContent.id} > ${filter.cursor}`);
  return db
    .select(contentColumns(timeZone))
    .from(marketingContent)
    .where(and(...conditions))
    .orderBy(asc(marketingContent.id))
    .limit(filter.limit + 1);
}

export async function insertContent(
  tx: Tx,
  input: { title: string; channel: MarketingChannel; campaignId: string | null; plannedFor: string | null; brief: string | null; createdBy: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO marketing_content (campaign_id, title, channel, planned_for, brief, created_by)
    VALUES (${input.campaignId}, ${input.title}, ${input.channel}::marketing_channel, ${input.plannedFor}::date, ${input.brief}, ${input.createdBy})
    RETURNING id
  `);
  return insertedId(result.rows, "Content");
}

export async function updateContent(
  tx: Tx,
  id: string,
  fields: Partial<
    Pick<typeof marketingContent.$inferInsert, "title" | "campaignId" | "plannedFor" | "brief" | "status" | "proofUrl" | "reach" | "engagements" | "clicks">
  >,
): Promise<void> {
  await tx
    .update(marketingContent)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(marketingContent.id, id));
}

/** The publish transition: status, proof link and published time together (one row check in the database). */
export async function publishContent(tx: Tx, id: string, proofUrl: string): Promise<void> {
  await tx
    .update(marketingContent)
    .set({ status: "published", proofUrl, publishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(marketingContent.id, id));
}

// Asset links

export function listAssets(db: Executor, contentId: string): Promise<AssetRow[]> {
  return db.select().from(marketingAssetLinks).where(eq(marketingAssetLinks.contentId, contentId)).orderBy(asc(marketingAssetLinks.createdAt), asc(marketingAssetLinks.id));
}

export async function findAsset(db: Executor, id: string): Promise<AssetRow | null> {
  const rows = await db.select().from(marketingAssetLinks).where(eq(marketingAssetLinks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertAsset(
  tx: Tx,
  input: { contentId: string; label: string; url: string; kind: AssetRow["kind"]; createdBy: string },
): Promise<AssetRow> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO marketing_asset_links (content_id, label, url, kind, created_by)
    VALUES (${input.contentId}, ${input.label}, ${input.url}, ${input.kind}::marketing_asset_kind, ${input.createdBy})
    RETURNING id
  `);
  const asset = await findAsset(tx, insertedId(result.rows, "Asset"));
  if (!asset) throw new Error("Asset not found after insert");
  return asset;
}

export async function removeAsset(tx: Tx, id: string, userId: string): Promise<AssetRow> {
  const [row] = await tx
    .update(marketingAssetLinks)
    .set({ removedAt: sql`now()`, removedBy: userId })
    .where(eq(marketingAssetLinks.id, id))
    .returning();
  if (!row) throw new Error("Asset update returned no row");
  return row;
}

// Dashboard

export async function summary(db: Executor, timeZone: string) {
  const campaigns = await db.execute<{ status: CampaignStatus; count: number }>(sql`
    SELECT status, count(*)::int AS count FROM marketing_campaigns GROUP BY status
  `);
  const content = await db.execute<{ status: ContentStatus; count: number }>(sql`
    SELECT status, count(*)::int AS count FROM marketing_content GROUP BY status
  `);
  const calendar = await db.execute<{ today: string; upcoming: number; overdue: number; in_review: number }>(sql`
    SELECT to_char(${today(timeZone)}, 'YYYY-MM-DD') AS today,
           count(*) FILTER (WHERE status IN ${UNFINISHED} AND planned_for BETWEEN ${today(timeZone)} AND ${today(timeZone)} + 13)::int AS upcoming,
           count(*) FILTER (WHERE status IN ${UNFINISHED} AND planned_for < ${today(timeZone)})::int AS overdue,
           count(*) FILTER (WHERE status = 'in_review')::int AS in_review
      FROM marketing_content
  `);
  const recent = await db.execute<{ channel: MarketingChannel; published: number; reach: number; engagements: number; clicks: number }>(sql`
    SELECT channel,
           count(*)::int AS published,
           coalesce(sum(reach), 0)::float8 AS reach,
           coalesce(sum(engagements), 0)::float8 AS engagements,
           coalesce(sum(clicks), 0)::float8 AS clicks
      FROM marketing_content
     WHERE status = 'published' AND published_at >= ((${today(timeZone)} - 29)::timestamp AT TIME ZONE ${timeZone})
     GROUP BY channel
  `);
  const row = calendar.rows[0];
  if (!row) throw new Error("Summary returned no row");
  return { campaigns: campaigns.rows, content: content.rows, today: row.today, upcoming: row.upcoming, overdue: row.overdue, inReview: row.in_review, recent: recent.rows };
}
