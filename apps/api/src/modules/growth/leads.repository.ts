import type { GrowthStage } from "@crm/contracts/growth-leads";
import { GROWTH_STALE_DAYS } from "@crm/contracts/growth-reports";
import { growthLeads, growthStageChanges } from "@crm/database/schema";
import { and, asc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

export const OPEN = sql`('new', 'contacted', 'qualified', 'proposal', 'negotiation')`;

/** "Today" in the organisation's time zone, computed by the database. */
export const today = (timeZone: string) => sql`(now() AT TIME ZONE ${timeZone})::date`;

/** Overdue from the day after next_follow_up_on, for open, non-archived leads. Outer columns are table-qualified. */
export const overdue = (timeZone: string) =>
  sql<boolean>`(growth_leads.archived_at IS NULL AND growth_leads.stage IN ${OPEN}
    AND growth_leads.next_follow_up_on IS NOT NULL AND growth_leads.next_follow_up_on < ${today(timeZone)})`;

/** Latest of creation, the last stage change and the last non-voided activity on the lead. */
const lastTouch = sql`GREATEST(
  growth_leads.created_at,
  (SELECT max(c.created_at) FROM growth_stage_changes c WHERE c.lead_id = growth_leads.id),
  (SELECT max(a.occurred_at) FROM growth_activities a WHERE a.lead_id = growth_leads.id AND a.voided_at IS NULL))`;

/** Open, non-archived leads whose last touch was more than GROWTH_STALE_DAYS days ago (org dates; ADR 0010). */
export const stale = (timeZone: string) =>
  sql<boolean>`(growth_leads.archived_at IS NULL AND growth_leads.stage IN ${OPEN}
    AND (${lastTouch} AT TIME ZONE ${timeZone})::date < ${today(timeZone)} - ${GROWTH_STALE_DAYS}::int)`;

const leadColumns = (timeZone: string) => ({
  id: growthLeads.id,
  name: growthLeads.name,
  companyId: growthLeads.companyId,
  primaryContactId: growthLeads.primaryContactId,
  source: growthLeads.source,
  sourceDetail: growthLeads.sourceDetail,
  ownerId: growthLeads.ownerId,
  ownerFlagged: sql<boolean>`NOT EXISTS (SELECT 1 FROM users o WHERE o.id = growth_leads.owner_id AND o.status = 'active' AND o.role = 'cgo')`,
  stage: growthLeads.stage,
  stageRevision: growthLeads.stageRevision,
  priority: growthLeads.priority,
  estimatedValueMinor: growthLeads.estimatedValueMinor,
  currency: growthLeads.currency,
  expectedCloseOn: growthLeads.expectedCloseOn,
  nextFollowUpOn: growthLeads.nextFollowUpOn,
  overdue: overdue(timeZone),
  lostReason: growthLeads.lostReason,
  lostNote: growthLeads.lostNote,
  lostAt: growthLeads.lostAt,
  version: growthLeads.version,
  createdBy: growthLeads.createdBy,
  createdAt: growthLeads.createdAt,
  updatedAt: growthLeads.updatedAt,
  archivedAt: growthLeads.archivedAt,
  wonAt: growthLeads.wonAt,
  wonVersionId: growthLeads.wonVersionId,
  wonAmountMinor: growthLeads.wonAmountMinor,
  wonCurrency: growthLeads.wonCurrency,
});

export type LeadRow = NonNullable<Awaited<ReturnType<typeof findLead>>>;
export type StageChangeRow = typeof growthStageChanges.$inferSelect;

export async function todayIn(db: Executor, timeZone: string): Promise<string> {
  const result = await db.execute<{ today: string }>(sql`SELECT to_char(${today(timeZone)}, 'YYYY-MM-DD') AS today`);
  const value = result.rows[0]?.today;
  if (value === undefined) throw new Error("Could not read today's date");
  return value;
}

export async function findLead(db: Executor, id: string, timeZone: string) {
  const rows = await db.select(leadColumns(timeZone)).from(growthLeads).where(eq(growthLeads.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks only the lead row until the transaction ends. */
export async function lockLead(tx: Tx, id: string, timeZone: string) {
  const rows = await tx.select(leadColumns(timeZone)).from(growthLeads).where(eq(growthLeads.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export function listLeads(
  db: Executor,
  filter: {
    stage: GrowthStage | undefined;
    owner: string | undefined;
    source: string | undefined;
    overdue: boolean | undefined;
    stale: boolean | undefined;
    archived: boolean;
    companyId: string | undefined;
    cursor: string | undefined;
    limit: number;
  },
  timeZone: string,
) {
  const conditions: SQL[] = [filter.archived ? isNotNull(growthLeads.archivedAt) : isNull(growthLeads.archivedAt)];
  if (filter.stage !== undefined) conditions.push(eq(growthLeads.stage, filter.stage));
  if (filter.owner !== undefined) conditions.push(eq(growthLeads.ownerId, filter.owner));
  if (filter.source !== undefined) conditions.push(sql`${growthLeads.source} = ${filter.source}::growth_lead_source`);
  if (filter.companyId !== undefined) conditions.push(eq(growthLeads.companyId, filter.companyId));
  if (filter.overdue === true) conditions.push(overdue(timeZone));
  if (filter.overdue === false) conditions.push(sql`NOT ${overdue(timeZone)}`);
  if (filter.stale === true) conditions.push(stale(timeZone));
  if (filter.stale === false) conditions.push(sql`NOT ${stale(timeZone)}`);
  if (filter.cursor !== undefined) conditions.push(sql`${growthLeads.id} > ${filter.cursor}`);
  return db
    .select(leadColumns(timeZone))
    .from(growthLeads)
    .where(and(...conditions))
    .orderBy(asc(growthLeads.id))
    .limit(filter.limit + 1);
}

/** Oldest first, one row per stage revision. */
export function stageHistory(db: Executor, leadId: string): Promise<StageChangeRow[]> {
  return db.select().from(growthStageChanges).where(eq(growthStageChanges.leadId, leadId)).orderBy(asc(growthStageChanges.stageRevision));
}

// Explicit column lists below: crm_app may insert only these columns.

export async function insertLead(
  tx: Tx,
  input: {
    name: string;
    companyId: string | null;
    primaryContactId: string | null;
    source: string;
    sourceDetail: string | null;
    ownerId: string;
    priority: string;
    estimatedValueMinor: number | null;
    expectedCloseOn: string | null;
    nextFollowUpOn: string | null;
    createdBy: string;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO growth_leads (name, company_id, primary_contact_id, source, source_detail, owner_id, priority,
                              estimated_value_minor, expected_close_on, next_follow_up_on, created_by)
    VALUES (${input.name}, ${input.companyId}, ${input.primaryContactId}, ${input.source}::growth_lead_source, ${input.sourceDetail},
            ${input.ownerId}, ${input.priority}::growth_priority, ${input.estimatedValueMinor}, ${input.expectedCloseOn}::date,
            ${input.nextFollowUpOn}::date, ${input.createdBy})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Lead insert returned no row");
  return row.id;
}

export async function updateLeadFields(
  tx: Tx,
  id: string,
  fields: Partial<
    Pick<
      typeof growthLeads.$inferInsert,
      | "name"
      | "companyId"
      | "primaryContactId"
      | "source"
      | "sourceDetail"
      | "priority"
      | "estimatedValueMinor"
      | "expectedCloseOn"
      | "nextFollowUpOn"
      | "ownerId"
      | "archivedAt"
    >
  >,
): Promise<void> {
  await tx
    .update(growthLeads)
    .set({ ...fields, version: sql`${growthLeads.version} + 1`, updatedAt: sql`now()` })
    .where(eq(growthLeads.id, id));
}

export async function archiveLead(tx: Tx, id: string): Promise<void> {
  await tx
    .update(growthLeads)
    .set({ archivedAt: sql`now()`, version: sql`${growthLeads.version} + 1`, updatedAt: sql`now()` })
    .where(eq(growthLeads.id, id));
}

/**
 * Changes the stage (setting or clearing the lost fields) and returns the new stage_revision, which the
 * database trigger increments by exactly one.
 */
export async function updateStage(
  tx: Tx,
  id: string,
  change: { to: GrowthStage; lostReason: string | null; lostNote: string | null },
): Promise<number> {
  const lost = change.to === "lost";
  const result = await tx.execute<{ stage_revision: number }>(sql`
    UPDATE growth_leads
       SET stage = ${change.to}::growth_stage,
           lost_reason = ${lost ? change.lostReason : null}::growth_lost_reason,
           lost_note = ${lost ? change.lostNote : null},
           lost_at = ${lost ? sql`now()` : sql`NULL`},
           version = version + 1,
           updated_at = now()
     WHERE id = ${id}
    RETURNING stage_revision
  `);
  const revision = result.rows[0]?.stage_revision;
  if (revision === undefined) throw new Error("Stage update returned no row");
  return revision;
}

/**
 * The only write of won_version_id: stage and won_version_id together. The database checks the accepted version
 * and sets won_at, the amount and the currency itself. Returns the new stage_revision.
 */
export async function markLeadWon(tx: Tx, id: string, versionId: string): Promise<number> {
  const result = await tx.execute<{ stage_revision: number }>(sql`
    UPDATE growth_leads
       SET stage = 'won', won_version_id = ${versionId}, version = version + 1, updated_at = now()
     WHERE id = ${id}
    RETURNING stage_revision
  `);
  const revision = result.rows[0]?.stage_revision;
  if (revision === undefined) throw new Error("Won update returned no row");
  return revision;
}

/** The history row for one stage revision, written right after the stage update in the same transaction. */
export async function insertStageChange(
  tx: Tx,
  input: {
    leadId: string;
    fromStage: GrowthStage;
    toStage: GrowthStage;
    actorId: string;
    note: string | null;
    lostReason: string | null;
    stageRevision: number;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, note, lost_reason, stage_revision)
    VALUES (${input.leadId}, ${input.fromStage}::growth_stage, ${input.toStage}::growth_stage, ${input.actorId},
            ${input.note}, ${input.lostReason}::growth_lost_reason, ${input.stageRevision})
  `);
}
