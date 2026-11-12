import type { AutomationStatus, IncidentSeverity, ReleaseStatus } from "@crm/contracts/operations";
import { sql } from "drizzle-orm";
import type { Executor } from "../../platform/context.js";

/** Dashboard counts only: no titles, notes or summaries. */
export async function summaryCounts(db: Executor) {
  const incidents = await db.execute<{ severity: IncidentSeverity; count: number }>(sql`
    SELECT severity, count(*)::int AS count FROM ops_incidents WHERE status <> 'resolved' GROUP BY severity
  `);
  const resolved = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM ops_incidents WHERE status = 'resolved' AND resolved_at >= now() - interval '30 days'
  `);
  const releases = await db.execute<{ status: ReleaseStatus; count: number }>(sql`
    SELECT status, count(*)::int AS count FROM ops_releases GROUP BY status
  `);
  const outcomes = await db.execute<{ deployed: number; failed: number; rolled_back: number }>(sql`
    SELECT count(*) FILTER (WHERE to_status = 'deployed')::int AS deployed,
           count(*) FILTER (WHERE to_status = 'failed')::int AS failed,
           count(*) FILTER (WHERE to_status = 'rolled_back')::int AS rolled_back
      FROM ops_release_decisions
     WHERE created_at >= now() - interval '30 days'
  `);
  const automations = await db.execute<{ status: AutomationStatus; count: number }>(sql`
    SELECT status, count(*)::int AS count FROM ops_automations GROUP BY status
  `);
  const outcome = outcomes.rows[0];
  return {
    openIncidents: incidents.rows,
    resolvedLast30Days: resolved.rows[0]?.count ?? 0,
    releases: releases.rows,
    deployed: outcome?.deployed ?? 0,
    failed: outcome?.failed ?? 0,
    rolledBack: outcome?.rolled_back ?? 0,
    automations: automations.rows,
  };
}
