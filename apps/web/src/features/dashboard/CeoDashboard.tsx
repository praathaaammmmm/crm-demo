import { approvalPageSchema } from "@crm/contracts/approvals";
import { operationsSummarySchema } from "@crm/contracts/operations";
import { directoryPageSchema } from "@crm/contracts/organization";
import { taskSummarySchema } from "@crm/contracts/tasks";
import Link from "next/link";
import { DashboardGrid, KpiStrip, Panel, SectionDivider, StatGrid, type Metric } from "../../components/Insights";
import { NotAllowed } from "../../components/NotAllowed";
import { GrowthSummary } from "../growth/GrowthSummary";
import { MarketingTiles } from "../marketing/MarketingTiles";
import { MeetingsSection } from "../meetings/MeetingsSection";
import { openIncidentCount, operationsMetrics } from "../operations/OperationsTiles";
import { QualityOverview } from "../quality/QualityOverview";
import { collectPages, dataOrForbidden, serverGet } from "../../lib/server-api";
import styles from "./Dashboard.module.css";
import { ReviewQueuePreview } from "./ReviewQueuePreview";

const MAX_PAGES = 5;

/** "250+" rather than a wrong number when the count reaches the page limit. */
const shown = (count: number, truncated: boolean) => (truncated ? `${String(count)}+` : String(count));

/** CEO-only operational overview built from existing endpoints. */
export async function CeoDashboard() {
  const [users, pending, taskResult, opsResult] = await Promise.all([
    collectPages("/users", directoryPageSchema, {}, MAX_PAGES),
    collectPages("/approvals", approvalPageSchema, { status: "pending" }, MAX_PAGES),
    serverGet("/tasks/summary", taskSummarySchema),
    serverGet("/operations/summary", operationsSummarySchema),
  ]);
  const directory = dataOrForbidden(users);
  const approvals = dataOrForbidden(pending);
  const tasks = dataOrForbidden(taskResult);
  if (directory === "forbidden" || approvals === "forbidden") return <NotAllowed />;
  const ops = dataOrForbidden(opsResult);

  const active = directory.items.filter((user) => user.status === "active").length;
  const deactivated = directory.items.length - active;
  const openIncidents = ops === "forbidden" ? null : openIncidentCount(ops);

  const taskKpis: Metric[] =
    tasks === "forbidden"
      ? []
      : [
    { label: "Overdue tasks", value: String(tasks.overdue), href: "/tasks?overdue=true", tone: tasks.overdue > 0 ? "danger" : undefined },
    { label: "Blocked tasks", value: String(tasks.blocked), href: "/tasks?status=blocked", tone: tasks.blocked > 0 ? "warning" : undefined },
    { label: "Pending review", value: String(tasks.pendingReview), href: "/review", tone: tasks.pendingReview > 0 ? "warning" : undefined },
        ];
  const kpis: Metric[] = [
    ...taskKpis,
    {
      label: "Pending approvals",
      value: shown(approvals.items.length, approvals.truncated),
      href: "/approvals?status=pending",
      tone: approvals.items.length > 0 ? "warning" : undefined,
    },
  ];
  if (openIncidents !== null) {
    kpis.push({ label: "Open incidents", value: String(openIncidents), href: "/operations/incidents?open=true", tone: openIncidents > 0 ? "danger" : undefined });
  }

  return (
    <>
      <KpiStrip label="Key metrics" metrics={kpis} />

      <DashboardGrid
        main={
          <>
            <GrowthSummary />
            <QualityOverview canManage previewRows={5} />
          </>
        }
        side={
          <>
            <Panel id="review-heading" title="Review queue" action={<Link href="/review">View all</Link>} flush>
              <ReviewQueuePreview />
            </Panel>
            <Panel id="org-heading" title="Organization" action={<Link href="/users">Users</Link>}>
              <StatGrid
                metrics={[
                  { label: "Active users", value: shown(active, directory.truncated) },
                  { label: "Deactivated users", value: shown(deactivated, directory.truncated) },
                  ...(tasks === "forbidden" ? [] : [{ label: "Completed tasks", value: String(tasks.completed), href: "/tasks?status=completed" }]),
                ]}
              />
            </Panel>
          </>
        }
      />

      <SectionDivider id="areas-heading" title="Areas" />
      <div className={styles.stack}>
        <MarketingTiles />
        {ops === "forbidden" ? null : (
          <Panel id="operations-heading" title="Engineering operations" action={<Link href="/operations">View overview</Link>}>
            <StatGrid metrics={operationsMetrics(ops)} />
          </Panel>
        )}
        <MeetingsSection summary />
      </div>
    </>
  );
}
