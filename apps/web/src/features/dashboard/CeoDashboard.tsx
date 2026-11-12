import { approvalPageSchema } from "@crm/contracts/approvals";
import { operationsSummarySchema } from "@crm/contracts/operations";
import { directoryPageSchema } from "@crm/contracts/organization";
import { statusLabel, TASK_STATUSES, taskPageSchema, taskSummarySchema } from "@crm/contracts/tasks";
import Link from "next/link";
import { ActionList, BarList, DashboardGrid, KpiStrip, Panel, PanelEmpty, SectionDivider, StatGrid, type ActionItem, type Metric } from "../../components/Insights";
import { CapNotice } from "../../components/CapNotice";
import { countBy, distributionRows } from "../../lib/chart-data";
import { TASK_CAP_NOTICE } from "../../lib/task-view";
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
/** The "needs attention" list stays short; the full lists are one click away. */
const ATTENTION_ROWS = 6;

/** "250+" rather than a wrong number when the count reaches the page limit. */
const shown = (count: number, truncated: boolean) => (truncated ? `${String(count)}+` : String(count));

/** CEO-only operational overview built from existing endpoints. */
export async function CeoDashboard() {
  const [users, pending, taskResult, opsResult, taskList] = await Promise.all([
    collectPages("/users", directoryPageSchema, {}, MAX_PAGES),
    collectPages("/approvals", approvalPageSchema, { status: "pending" }, MAX_PAGES),
    serverGet("/tasks/summary", taskSummarySchema),
    serverGet("/operations/summary", operationsSummarySchema),
    collectPages("/tasks", taskPageSchema, {}, MAX_PAGES),
  ]);
  const directory = dataOrForbidden(users);
  const approvals = dataOrForbidden(pending);
  const tasks = dataOrForbidden(taskResult);
  if (directory === "forbidden" || approvals === "forbidden") return <NotAllowed />;
  const ops = dataOrForbidden(opsResult);
  const allTasks = dataOrForbidden(taskList);

  // Needs attention: overdue or blocked tasks, then pending approvals. Real records only, capped for the panel.
  const attention: ActionItem[] = [
    ...(allTasks === "forbidden" ? [] : allTasks.items)
      .filter((task) => task.overdue || task.status === "blocked")
      .map((task) => ({
        key: task.id,
        title: task.title,
        href: `/tasks/${task.id}`,
        meta: task.overdue ? `Overdue · due ${task.dueDate}` : statusLabel(task.status),
        tone: task.overdue ? ("danger" as const) : ("warning" as const),
      })),
    ...approvals.items.map((approval) => ({
      key: approval.id,
      title: approval.type === "user.role_change" ? "Role change request" : "Deactivation request",
      href: "/approvals?status=pending",
      meta: "Awaiting your approval",
      tone: "warning" as const,
    })),
  ].slice(0, ATTENTION_ROWS);

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
            {allTasks === "forbidden" ? null : (
              <Panel id="task-status-heading" title="Tasks by status" action={<Link href="/tasks">All tasks</Link>}>
                <CapNotice show={allTasks.truncated} message={TASK_CAP_NOTICE.list} />
                {allTasks.items.length === 0 ? (
                  <PanelEmpty>No tasks yet.</PanelEmpty>
                ) : (
                  <BarList
                    label="Tasks by status"
                    total={`${String(allTasks.items.length)} tasks`}
                    rows={distributionRows(countBy(allTasks.items, (task) => task.status, TASK_STATUSES), statusLabel, { hideZero: true })}
                    legend="Bar length: number of tasks. Figures: count · share of all tasks."
                  />
                )}
              </Panel>
            )}
            <QualityOverview canManage previewRows={5} />
          </>
        }
        side={
          <>
            <Panel id="attention-heading" title="Needs attention" flush>
              <ActionList label="Needs attention" items={attention} empty="Nothing overdue, blocked or waiting for approval." />
            </Panel>
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
