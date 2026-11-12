import type { LostReason, OpenStage } from "@crm/contracts/growth-leads";
import type { ReportRange } from "@crm/contracts/growth-reports";
import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "../../platform/context.js";
import { OPEN, overdue, stale } from "./leads.repository.js";

/**
 * Read-only Growth aggregates (ADR 0010). Live figures exclude archived leads; historical won/lost figures in the
 * range include them. Timestamps are compared against the range's org-time-zone day boundaries (index friendly).
 */

/** Sums are bigint (returned as text by the driver); per-lead values are capped at 10^11, so totals stay exact. */
const toNumber = (value: string | number | null | undefined): number => {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new Error("Report total out of range");
  return result;
};

const bounds = (range: ReportRange, timeZone: string) => ({
  start: sql`(${range.from}::date::timestamp AT TIME ZONE ${timeZone})`,
  end: sql`((${range.to}::date + 1)::timestamp AT TIME ZONE ${timeZone})`,
});
const within = (column: SQL, range: ReportRange, timeZone: string) => {
  const { start, end } = bounds(range, timeZone);
  return sql`(${column} >= ${start} AND ${column} < ${end})`;
};

const LIVE = sql`(growth_leads.archived_at IS NULL AND growth_leads.stage IN ${OPEN})`;
const won = (range: ReportRange, timeZone: string) => sql`(growth_leads.stage = 'won' AND ${within(sql`growth_leads.won_at`, range, timeZone)})`;
const lost = (range: ReportRange, timeZone: string) => sql`(growth_leads.stage = 'lost' AND ${within(sql`growth_leads.lost_at`, range, timeZone)})`;

export async function stageSnapshot(db: Executor, timeZone: string) {
  const result = await db.execute<{ stage: OpenStage; count: number; value: string; unvalued: number; overdue: number; stale: number }>(sql`
    SELECT growth_leads.stage,
           count(*)::int AS count,
           coalesce(sum(growth_leads.estimated_value_minor), 0)::bigint AS value,
           count(*) FILTER (WHERE growth_leads.estimated_value_minor IS NULL)::int AS unvalued,
           count(*) FILTER (WHERE ${overdue(timeZone)})::int AS overdue,
           count(*) FILTER (WHERE ${stale(timeZone)})::int AS stale
      FROM growth_leads
     WHERE ${LIVE}
     GROUP BY growth_leads.stage
  `);
  return result.rows.map((row) => ({ ...row, value: toNumber(row.value) }));
}

/** New = leads created in the range; every other stage, lost included = distinct leads that entered it in the range. */
export async function funnel(db: Executor, range: ReportRange, timeZone: string) {
  const result = await db.execute<{ stage: string; entered: number }>(sql`
    SELECT 'new' AS stage, count(*)::int AS entered
      FROM growth_leads
     WHERE ${within(sql`growth_leads.created_at`, range, timeZone)}
    UNION ALL
    SELECT c.to_stage::text AS stage, count(DISTINCT c.lead_id)::int AS entered
      FROM growth_stage_changes c
     WHERE c.to_stage <> 'new' AND ${within(sql`c.created_at`, range, timeZone)}
     GROUP BY c.to_stage
  `);
  return new Map(result.rows.map((row) => [row.stage, row.entered]));
}

export async function closed(db: Executor, range: ReportRange, timeZone: string) {
  const totals = await db.execute<{ won_count: number; won_amount: string; lost_count: number }>(sql`
    SELECT count(*) FILTER (WHERE ${won(range, timeZone)})::int AS won_count,
           coalesce(sum(growth_leads.won_amount_minor) FILTER (WHERE ${won(range, timeZone)}), 0)::bigint AS won_amount,
           count(*) FILTER (WHERE ${lost(range, timeZone)})::int AS lost_count
      FROM growth_leads
     WHERE growth_leads.stage IN ('won', 'lost')
  `);
  const reasons = await db.execute<{ reason: LostReason; count: number }>(sql`
    SELECT growth_leads.lost_reason AS reason, count(*)::int AS count
      FROM growth_leads
     WHERE ${lost(range, timeZone)}
     GROUP BY growth_leads.lost_reason
     ORDER BY count DESC, reason
  `);
  const row = totals.rows[0];
  return {
    wonCount: row?.won_count ?? 0,
    wonAmountMinor: toNumber(row?.won_amount),
    lostCount: row?.lost_count ?? 0,
    lostReasons: reasons.rows,
  };
}

export async function proposalQueue(db: Executor) {
  const result = await db.execute<{ pending_approval: number; acceptance_pending: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval,
           count(*) FILTER (WHERE status = 'acceptance_pending')::int AS acceptance_pending
      FROM growth_proposals
  `);
  const row = result.rows[0];
  return { pendingApproval: row?.pending_approval ?? 0, acceptancePending: row?.acceptance_pending ?? 0 };
}

type Dimension = "source" | "owner" | "company";

const KEY: Record<Dimension, SQL> = {
  source: sql`growth_leads.source::text`,
  owner: sql`growth_leads.owner_id`,
  company: sql`growth_leads.company_id`,
};

/** Outcome columns per source, owner or company: live open figures and historical won/lost in the range. */
export async function breakdown(db: Executor, dimension: Dimension, range: ReportRange, timeZone: string) {
  const key = KEY[dimension];
  const extra =
    dimension === "owner"
      ? sql`, NOT EXISTS (SELECT 1 FROM users o WHERE o.id = growth_leads.owner_id AND o.status = 'active' AND o.role = 'cgo') AS flagged`
      : dimension === "company"
        ? sql`, max(growth_companies.name) AS name`
        : sql``;
  const join = dimension === "company" ? sql`LEFT JOIN growth_companies ON growth_companies.id = growth_leads.company_id` : sql``;
  const result = await db.execute<{
    key: string | null;
    open_count: number;
    open_value: string;
    won_count: number;
    won_amount: string;
    lost_count: number;
    flagged?: boolean;
    name?: string | null;
  }>(sql`
    SELECT ${key} AS key,
           count(*) FILTER (WHERE ${LIVE})::int AS open_count,
           coalesce(sum(growth_leads.estimated_value_minor) FILTER (WHERE ${LIVE}), 0)::bigint AS open_value,
           count(*) FILTER (WHERE ${won(range, timeZone)})::int AS won_count,
           coalesce(sum(growth_leads.won_amount_minor) FILTER (WHERE ${won(range, timeZone)}), 0)::bigint AS won_amount,
           count(*) FILTER (WHERE ${lost(range, timeZone)})::int AS lost_count
           ${extra}
      FROM growth_leads
      ${join}
     WHERE ${LIVE} OR ${won(range, timeZone)} OR ${lost(range, timeZone)}
     GROUP BY ${key}
  `);
  return result.rows.map((row) => ({
    key: row.key,
    flagged: row.flagged ?? false,
    name: row.name ?? null,
    openCount: row.open_count,
    openValueMinor: toNumber(row.open_value),
    wonCount: row.won_count,
    wonAmountMinor: toNumber(row.won_amount),
    lostCount: row.lost_count,
  }));
}
