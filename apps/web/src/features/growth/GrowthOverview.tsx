import { formatInr, stageLabel, type Lead } from "@crm/contracts/growth-leads";
import type { GrowthOverview as Overview, OutcomeRow } from "@crm/contracts/growth-reports";
import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import {
  ActionList,
  BarList,
  DashboardGrid,
  KpiStrip,
  Panel,
  PanelEmpty,
  SectionDivider,
  StatGrid,
  type ActionItem,
  type Metric,
} from "../../components/Insights";
import { formatPercent, LOST_LABELS, SOURCE_LABELS } from "../../lib/growth-report-view";
import { formatDate } from "../tasks/DueDate";
import styles from "./Growth.module.css";
import { LeadTable } from "./LeadTable";

/**
 * Growth summary metrics. Links only where the lead list supports the filter (overdue, stale, open list);
 * range-bound figures (won, lost, win rate) and proposal counts have no matching filter and are plain text.
 */
export function growthMetrics(data: Overview): { primary: Metric[]; secondary: Metric[] } {
  const { pipeline, closed, proposals } = data;
  return {
    primary: [
      {
        label: "Open pipeline",
        value: formatInr(pipeline.openValueMinor),
        detail: `${String(pipeline.openCount)} open · ${String(pipeline.unvaluedCount)} without a value`,
        href: "/growth/leads",
      },
      {
        label: "Overdue follow-ups",
        value: String(pipeline.overdueCount),
        href: "/growth/leads?view=list&overdue=true",
        tone: pipeline.overdueCount > 0 ? "danger" : undefined,
      },
      {
        label: `Stale (over ${String(data.staleDays)} days)`,
        value: String(pipeline.staleCount),
        href: "/growth/leads?view=list&stale=true",
        tone: pipeline.staleCount > 0 ? "warning" : undefined,
      },
      { label: "Win rate", value: formatPercent(closed.winRate), detail: "Won ÷ (won + lost) in range" },
    ],
    secondary: [
      { label: "Won in range", value: formatInr(closed.wonAmountMinor), detail: `${String(closed.wonCount)} won` },
      { label: "Lost in range", value: String(closed.lostCount) },
      { label: "Awaiting approval", value: String(proposals.pendingApproval) },
      { label: "Acceptances to confirm", value: String(proposals.acceptancePending) },
    ],
  };
}

/** Open leads by stage, with count and value printed for every bar. */
export function PipelineBars({ data }: { data: Overview }) {
  return data.pipeline.openCount === 0 ? (
    <EmptyState title="No open leads">Leads appear here as the CGO adds them.</EmptyState>
  ) : (
    <BarList
      label="Open leads by stage"
      legend="Bar length: number of open leads. Figures: count · estimated value."
      rows={data.stages.map((row) => ({ key: row.stage, label: stageLabel(row.stage), value: row.count, text: `${String(row.count)} · ${formatInr(row.valueMinor)}` }))}
    />
  );
}

/** Leads whose follow-up date has passed, as an action list. */
export function overdueItems(leads: Lead[], companyOf: (id: string | null) => string, nameOf: (id: string) => string): ActionItem[] {
  return leads.map((lead) => ({
    key: lead.id,
    title: lead.name,
    href: `/growth/leads/${lead.id}`,
    meta: `${companyOf(lead.companyId)} · ${nameOf(lead.ownerId)}`,
    trailing: lead.nextFollowUpOn === null ? undefined : formatDate(lead.nextFollowUpOn),
    tone: "danger",
  }));
}

const outcomeColumns = <T extends OutcomeRow>(): Column<T>[] => [
  { key: "open", header: "Open", render: (row) => String(row.openCount) },
  { key: "value", header: "Open value", render: (row) => formatInr(row.openValueMinor) },
  { key: "won", header: "Won", render: (row) => String(row.wonCount) },
  { key: "amount", header: "Won value", render: (row) => formatInr(row.wonAmountMinor) },
  { key: "lost", header: "Lost", render: (row) => String(row.lostCount) },
];

type CompanyRow = Overview["byCompany"][number];
type OwnerRow = Overview["byOwner"][number];
type SourceRow = Overview["bySource"][number];

/** The full CGO/CEO overview body. Read-only: actions live on the lead and proposal pages. */
export function GrowthOverviewBody(props: {
  data: Overview;
  overdue: Lead[];
  stale: Lead[];
  nameOf: (id: string) => string;
  companyOf: (id: string | null) => string;
}) {
  const { data } = props;
  const closedInRange = data.closed.wonCount + data.closed.lostCount > 0;
  const enteredInRange = data.funnel.some((row) => row.entered > 0);

  const companyName = (row: CompanyRow) => (row.kind === "none" ? "No company" : row.kind === "other" ? "Other companies" : (row.name ?? "Company"));
  const leadList = (leads: Lead[], empty: string) =>
    leads.length === 0 ? <PanelEmpty>{empty}</PanelEmpty> : <LeadTable leads={leads} nameOf={props.nameOf} companyOf={props.companyOf} />;

  const metrics = growthMetrics(data);
  const table = (id: string, title: string, children: ReactNode, action?: ReactNode) => (
    <Panel id={id} title={title} action={action} flush>
      {children}
    </Panel>
  );

  return (
    <>
      <KpiStrip label="Growth summary" metrics={metrics.primary} />

      <DashboardGrid
        main={
          <>
            <Panel id="stages-heading" title="Open pipeline by stage" action={<Link href="/growth/leads">Pipeline board</Link>}>
              <PipelineBars data={data} />
            </Panel>
            {table(
              "stale-heading",
              `Stale leads (no touch for over ${String(data.staleDays)} days)`,
              leadList(props.stale, "No stale leads."),
              <Link href="/growth/leads?view=list&stale=true">View all</Link>,
            )}
          </>
        }
        side={
          <>
            <Panel id="overdue-heading" title="Overdue follow-ups" action={<Link href="/growth/leads?view=list&overdue=true">View all</Link>} flush>
              <ActionList label="Overdue follow-ups" items={overdueItems(props.overdue, props.companyOf, props.nameOf)} empty="No overdue follow-ups." />
            </Panel>
            <Panel id="closed-heading" title="Closed and proposals in range">
              <StatGrid metrics={metrics.secondary} />
            </Panel>
          </>
        }
      />

      <SectionDivider id="breakdowns-heading" title="Breakdowns" />
      <div className={styles.panelGrid}>
        <Panel id="funnel-heading" title="Funnel in range">
          {enteredInRange ? (
            <BarList
              label="Leads entering each stage"
              rows={data.funnel.map((row) => ({ key: row.stage, label: stageLabel(row.stage), value: row.entered, text: String(row.entered) }))}
            />
          ) : (
            <PanelEmpty>Nothing in this range.</PanelEmpty>
          )}
        </Panel>
        <Panel id="lost-heading" title="Lost reasons in range">
          {closedInRange && data.closed.lostReasons.length > 0 ? (
            <BarList
              label="Lost leads by reason"
              rows={data.closed.lostReasons.map((row) => ({ key: row.reason, label: LOST_LABELS[row.reason], value: row.count, text: String(row.count) }))}
            />
          ) : (
            <PanelEmpty>Nothing lost in this range.</PanelEmpty>
          )}
        </Panel>
      </div>

      <div className={styles.stack}>
        {table(
          "owner-heading",
          "By owner",
          data.byOwner.length === 0 ? (
            <PanelEmpty>No leads yet.</PanelEmpty>
          ) : (
            <DataTable<OwnerRow>
              caption="Outcomes by owner"
              density="compact"
              rowKey={(row) => row.ownerId}
              rows={data.byOwner}
              columns={[
                { key: "owner", header: "Owner", render: (row) => `${props.nameOf(row.ownerId)}${row.ownerFlagged ? " (needs reassignment)" : ""}` },
                ...outcomeColumns<OwnerRow>(),
              ]}
            />
          ),
        )}
        {table(
          "source-heading",
          "By source",
          <DataTable<SourceRow>
            caption="Outcomes by source"
            density="compact"
            rowKey={(row) => row.source}
            rows={data.bySource}
            columns={[{ key: "source", header: "Source", render: (row) => SOURCE_LABELS[row.source] }, ...outcomeColumns<SourceRow>()]}
          />,
        )}
        {table(
          "company-heading",
          "By company",
          data.byCompany.length === 0 ? (
            <PanelEmpty>No leads yet.</PanelEmpty>
          ) : (
            <DataTable<CompanyRow>
              caption="Outcomes by company"
              density="compact"
              rowKey={(row) => row.companyId ?? row.kind}
              rows={data.byCompany}
              columns={[
                {
                  key: "company",
                  header: "Company",
                  render: (row) =>
                    row.kind === "company" && row.companyId !== null ? <Link href={`/growth/companies/${row.companyId}`}>{companyName(row)}</Link> : companyName(row),
                },
                ...outcomeColumns<CompanyRow>(),
              ]}
            />
          ),
        )}
      </div>
    </>
  );
}
