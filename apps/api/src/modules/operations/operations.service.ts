import { AUTOMATION_STATUSES, INCIDENT_SEVERITIES, RELEASE_STATUSES, type OperationsSummary } from "@crm/contracts/operations";
import type { AuthSession } from "../../platform/context.js";
import * as automations from "./automations.repository.js";
import { healthOf } from "./automations.service.js";
import type { OperationsDeps } from "./incidents.service.js";
import * as repo from "./operations.repository.js";
import * as policy from "./operations.policy.js";

type User = AuthSession["user"];


/** VP operations dashboard and the CEO/CTO read-only overview. */
export async function summary(deps: OperationsDeps, user: User): Promise<OperationsSummary> {
  policy.assertCanRead(user);
  const raw = await repo.summaryCounts(deps.db);
  // The live registry is small, so health uses the shared contract rule rather than a second SQL definition.
  const live = await automations.listAutomations(deps.db, { status: "live", cursor: undefined, limit: 1000 });
  const incidents = new Map(raw.openIncidents.map((row) => [row.severity, row.count] as const));
  const releases = new Map(raw.releases.map((row) => [row.status, row.count] as const));
  const statuses = new Map(raw.automations.map((row) => [row.status, row.count] as const));

  return {
    openIncidentsBySeverity: INCIDENT_SEVERITIES.map((severity) => ({ severity, count: incidents.get(severity) ?? 0 })),
    incidentsResolvedLast30Days: raw.resolvedLast30Days,
    releasesByStatus: RELEASE_STATUSES.map((status) => ({ status, count: releases.get(status) ?? 0 })),
    releasesAwaitingApproval: releases.get("awaiting_approval") ?? 0,
    deploymentsLast30Days: { deployed: raw.deployed, failed: raw.failed, rolledBack: raw.rolledBack },
    automationsByStatus: AUTOMATION_STATUSES.map((status) => ({ status, count: statuses.get(status) ?? 0 })),
    automationsAwaitingApproval: statuses.get("awaiting_approval") ?? 0,
    unhealthyLiveAutomations: live.filter((row) => ["degraded", "failing"].includes(healthOf(row))).length,
  };
}
