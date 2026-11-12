import { operationsSummarySchema } from "@crm/contracts/operations";
import Link from "next/link";
import { Icon } from "../../components/Icon";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import dashboard from "../dashboard/Dashboard.module.css";

/** Operations counts for the VP Engineering & Quality and the CEO/CTO; nothing for anyone else. */
export async function OperationsTiles({ heading = true }: { heading?: boolean }) {
  const summary = dataOrForbidden(await serverGet("/operations/summary", operationsSummarySchema));
  if (summary === "forbidden") return null;
  const open = summary.openIncidentsBySeverity.reduce((total, row) => total + row.count, 0);
  const sev1 = summary.openIncidentsBySeverity.find((row) => row.severity === "sev1")?.count ?? 0;
  const tiles = [
    { label: "Open incidents", value: open, href: "/operations/incidents?open=true", tone: open > 0 ? ("danger" as const) : undefined },
    { label: "Open SEV 1", value: sev1, href: "/operations/incidents?open=true&severity=sev1", tone: sev1 > 0 ? ("danger" as const) : undefined },
    { label: "Releases awaiting approval", value: summary.releasesAwaitingApproval, href: "/operations/releases?status=awaiting_approval", tone: undefined },
    { label: "Automations awaiting approval", value: summary.automationsAwaitingApproval, href: "/operations/automations?status=awaiting_approval", tone: undefined },
    { label: "Unhealthy live automations", value: summary.unhealthyLiveAutomations, href: "/operations/automations?status=live", tone: "warning" as const },
    { label: "Deployed (30 days)", value: summary.deploymentsLast30Days.deployed, href: "/operations/releases?status=deployed", tone: undefined },
    { label: "Rollbacks (30 days)", value: summary.deploymentsLast30Days.rolledBack, href: "/operations/releases?status=rolled_back", tone: undefined },
  ];
  return (
    <section className={dashboard.section} aria-labelledby="operations-heading">
      {heading ? (
        <div className={dashboard.sectionHeader}>
          <h2 id="operations-heading" className={dashboard.sectionTitle}>
            Engineering operations
          </h2>
          <Link href="/operations">View overview</Link>
        </div>
      ) : (
        <h2 id="operations-heading" className="visually-hidden">
          Operations summary
        </h2>
      )}
      <div className={dashboard.grid}>
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className={[dashboard.tile, tile.tone ? dashboard[tile.tone] : undefined].filter(Boolean).join(" ")}>
            <span className={dashboard.tileTop}>
              <Icon name={tile.tone === "danger" ? "alert" : "gauge"} />
              {tile.label}
            </span>
            <span className={dashboard.value}>{String(tile.value)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
