import { LEAD_SOURCES, OPEN_STAGES } from "@crm/contracts/growth-leads";
import {
  FUNNEL_STAGES,
  GROWTH_STALE_DAYS,
  REPORT_TOP_COMPANIES,
  resolveReportRange,
  type GrowthOverview,
  type GrowthReportQuery,
  type OutcomeRow,
} from "@crm/contracts/growth-reports";
import type { Database } from "@crm/database/client";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import * as policy from "./growth.policy.js";
import { todayIn } from "./leads.repository.js";
import * as repo from "./reports.repository.js";

type User = AuthSession["user"];

export interface ReportDeps {
  db: Database;
  orgTimezone: string;
}

const ZERO: OutcomeRow = { openCount: 0, openValueMinor: 0, wonCount: 0, wonAmountMinor: 0, lostCount: 0 };

const outcome = (row: OutcomeRow): OutcomeRow => ({
  openCount: row.openCount,
  openValueMinor: row.openValueMinor,
  wonCount: row.wonCount,
  wonAmountMinor: row.wonAmountMinor,
  lostCount: row.lostCount,
});

const add = (a: OutcomeRow, b: OutcomeRow): OutcomeRow => ({
  openCount: a.openCount + b.openCount,
  openValueMinor: a.openValueMinor + b.openValueMinor,
  wonCount: a.wonCount + b.wonCount,
  wonAmountMinor: a.wonAmountMinor + b.wonAmountMinor,
  lostCount: a.lostCount + b.lostCount,
});

/** Largest first: open value, then won amount, then open count. */
const byWeight = (a: OutcomeRow, b: OutcomeRow) =>
  b.openValueMinor - a.openValueMinor || b.wonAmountMinor - a.wonAmountMinor || b.openCount - a.openCount;

/** The top named companies, then "No company", then everything else folded into one "other" row. */
function companyRows(rows: Awaited<ReturnType<typeof repo.breakdown>>): GrowthOverview["byCompany"] {
  const named = rows.filter((row) => row.key !== null).sort((a, b) => byWeight(a, b) || (a.name ?? "").localeCompare(b.name ?? ""));
  const result: GrowthOverview["byCompany"] = named
    .slice(0, REPORT_TOP_COMPANIES)
    .map((row) => ({ kind: "company", companyId: row.key, name: row.name, ...outcome(row) }));
  const none = rows.find((row) => row.key === null);
  if (none) result.push({ kind: "none", companyId: null, name: null, ...outcome(none) });
  const rest = named.slice(REPORT_TOP_COMPANIES);
  if (rest.length > 0) result.push({ kind: "other", companyId: null, name: null, ...rest.map(outcome).reduce(add, ZERO) });
  return result;
}

/**
 * CEO/CTO and CGO (growth:read_all). Read-only, so nothing is audited; no contact data is read. Every query runs
 * in one read-only repeatable-read transaction, so all figures come from the same snapshot.
 */
export async function overview(deps: ReportDeps, user: User, query: GrowthReportQuery): Promise<GrowthOverview> {
  policy.assertCanRead(user);
  const tz = deps.orgTimezone;
  return deps.db.transaction(
    async (tx) => {
      const today = await todayIn(tx, tz);
      const resolved = resolveReportRange(query, today);
      if (!resolved.ok) throw errors.validation(resolved.message);
      const { range } = resolved;

      const snapshot = await repo.stageSnapshot(tx, tz);
      const entered = await repo.funnel(tx, range, tz);
      const closed = await repo.closed(tx, range, tz);
      const proposals = await repo.proposalQueue(tx);
      const sources = await repo.breakdown(tx, "source", range, tz);
      const owners = await repo.breakdown(tx, "owner", range, tz);
      const companies = await repo.breakdown(tx, "company", range, tz);

      const sum = (pick: (row: (typeof snapshot)[number]) => number) => snapshot.reduce((total, row) => total + pick(row), 0);
      const decided = closed.wonCount + closed.lostCount;

      return {
        currency: "INR",
        today,
        range,
        staleDays: GROWTH_STALE_DAYS,
        pipeline: {
          openCount: sum((row) => row.count),
          openValueMinor: sum((row) => row.value),
          unvaluedCount: sum((row) => row.unvalued),
          overdueCount: sum((row) => row.overdue),
          staleCount: sum((row) => row.stale),
        },
        stages: OPEN_STAGES.map((stage) => {
          const row = snapshot.find((item) => item.stage === stage);
          return { stage, count: row?.count ?? 0, valueMinor: row?.value ?? 0 };
        }),
        funnel: FUNNEL_STAGES.map((stage) => ({ stage, entered: entered.get(stage) ?? 0 })),
        closed: {
          wonCount: closed.wonCount,
          wonAmountMinor: closed.wonAmountMinor,
          lostCount: closed.lostCount,
          winRate: decided === 0 ? null : closed.wonCount / decided,
          lostReasons: closed.lostReasons.map((row) => ({ reason: row.reason, count: row.count })),
        },
        proposals,
        bySource: LEAD_SOURCES.map((source) => {
          const row = sources.find((item) => item.key === source);
          return { source, ...(row ? outcome(row) : ZERO) };
        }),
        byOwner: owners
          .filter((row): row is typeof row & { key: string } => row.key !== null)
          .sort(byWeight)
          .map((row) => ({ ownerId: row.key, ownerFlagged: row.flagged, ...outcome(row) })),
        byCompany: companyRows(companies),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
