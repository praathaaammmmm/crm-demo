import { formatInr, stageLabel, type Lead } from "@crm/contracts/growth-leads";
import type { GrowthOverview as Overview, OutcomeRow } from "@crm/contracts/growth-reports";
import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Icon, type IconName } from "../../components/Icon";
import { barPercent, formatPercent, LOST_LABELS, SOURCE_LABELS } from "../../lib/growth-report-view";
import dashboard from "../dashboard/Dashboard.module.css";
import styles from "./Growth.module.css";
import { LeadTable } from "./LeadTable";

interface Tile {
  label: string;
  value: string;
  detail?: string;
  href: string;
  icon: IconName;
  tone?: "danger" | "warning";
}

/** Tiles that link to the matching filtered view. Used on the overview and, compactly, on home pages. */
export function GrowthTiles({ data, compact = false }: { data: Overview; compact?: boolean }) {
  const { pipeline, closed, proposals } = data;
  const tiles: Tile[] = [
    {
      label: "Open pipeline",
      value: formatInr(pipeline.openValueMinor),
      detail: `${String(pipeline.openCount)} open · ${String(pipeline.unvaluedCount)} without a value`,
      href: "/growth/leads",
      icon: "board",
    },
    { label: "Overdue follow-ups", value: String(pipeline.overdueCount), href: "/growth/leads?view=list&overdue=true", icon: "alert", tone: "danger" },
    { label: `Stale (over ${String(data.staleDays)} days)`, value: String(pipeline.staleCount), href: "/growth/leads?view=list&stale=true", icon: "alert", tone: "warning" },
    { label: "Won in range", value: formatInr(closed.wonAmountMinor), detail: `${String(closed.wonCount)} won`, href: "/growth/leads?view=list&stage=won", icon: "check" },
  ];
  if (!compact) {
    tiles.push(
      { label: "Lost in range", value: String(closed.lostCount), href: "/growth/leads?view=list&stage=lost", icon: "x" },
      { label: "Win rate", value: formatPercent(closed.winRate), detail: "Won ÷ (won + lost) in range", href: "/growth/leads?view=list&stage=won", icon: "gauge" },
      { label: "Awaiting approval", value: String(proposals.pendingApproval), href: "/growth/proposals", icon: "inbox" },
      { label: "Acceptances to confirm", value: String(proposals.acceptancePending), href: "/growth/proposals", icon: "inbox" },
    );
  }
  return (
    <div className={dashboard.grid}>
      {tiles.map((tile) => (
        <Link key={tile.label} href={tile.href} className={[dashboard.tile, tile.tone ? dashboard[tile.tone] : undefined].filter(Boolean).join(" ")}>
          <span className={dashboard.tileTop}>
            <Icon name={tile.icon} />
            {tile.label}
          </span>
          <span className={dashboard.value}>{tile.value}</span>
          {tile.detail ? <span className={dashboard.label}>{tile.detail}</span> : null}
        </Link>
      ))}
    </div>
  );
}

function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHeader}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Horizontal CSS bars; the value is always printed, so the bar is never the only signal. */
function Bars({ label, rows }: { label: string; rows: { key: string; label: string; value: number; text: string }[] }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  return (
    <ul className={styles.bars} aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={styles.barRow}>
          <span className={styles.barLabel}>{row.label}</span>
          <span className={styles.barTrack} aria-hidden="true">
            <span className={styles.barFill} style={{ width: `${String(barPercent(row.value, max))}%` }} />
          </span>
          <span className={styles.barValue}>{row.text}</span>
        </li>
      ))}
    </ul>
  );
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
    leads.length === 0 ? <p className={styles.muted}>{empty}</p> : <LeadTable leads={leads} nameOf={props.nameOf} companyOf={props.companyOf} />;

  return (
    <>
      <GrowthTiles data={data} />

      <div className={styles.reportGrid}>
        <Section id="stages-heading" title="Open pipeline by stage">
          {data.pipeline.openCount === 0 ? (
            <EmptyState title="No open leads" />
          ) : (
            <Bars
              label="Open leads by stage"
              rows={data.stages.map((row) => ({ key: row.stage, label: stageLabel(row.stage), value: row.count, text: `${String(row.count)} · ${formatInr(row.valueMinor)}` }))}
            />
          )}
        </Section>

        <Section id="funnel-heading" title="Funnel in range">
          {enteredInRange ? (
            <Bars
              label="Leads entering each stage"
              rows={data.funnel.map((row) => ({ key: row.stage, label: stageLabel(row.stage), value: row.entered, text: String(row.entered) }))}
            />
          ) : (
            <EmptyState title="Nothing in this range" />
          )}
        </Section>

        <Section id="lost-heading" title="Lost reasons in range">
          {closedInRange && data.closed.lostReasons.length > 0 ? (
            <Bars
              label="Lost leads by reason"
              rows={data.closed.lostReasons.map((row) => ({ key: row.reason, label: LOST_LABELS[row.reason], value: row.count, text: String(row.count) }))}
            />
          ) : (
            <EmptyState title="Nothing lost in this range" />
          )}
        </Section>
      </div>

      <Section id="overdue-heading" title="Overdue follow-ups" action={<Link href="/growth/leads?view=list&overdue=true">View all</Link>}>
        {leadList(props.overdue, "No overdue follow-ups.")}
      </Section>

      <Section id="stale-heading" title={`Stale leads (no touch for over ${String(data.staleDays)} days)`} action={<Link href="/growth/leads?view=list&stale=true">View all</Link>}>
        {leadList(props.stale, "No stale leads.")}
      </Section>

      <Section id="owner-heading" title="By owner">
        {data.byOwner.length === 0 ? (
          <p className={styles.muted}>No leads yet.</p>
        ) : (
          <DataTable<OwnerRow>
            caption="Outcomes by owner"
            rowKey={(row) => row.ownerId}
            rows={data.byOwner}
            columns={[
              { key: "owner", header: "Owner", render: (row) => `${props.nameOf(row.ownerId)}${row.ownerFlagged ? " (needs reassignment)" : ""}` },
              ...outcomeColumns<OwnerRow>(),
            ]}
          />
        )}
      </Section>

      <Section id="source-heading" title="By source">
        <DataTable<SourceRow>
          caption="Outcomes by source"
          rowKey={(row) => row.source}
          rows={data.bySource}
          columns={[{ key: "source", header: "Source", render: (row) => SOURCE_LABELS[row.source] }, ...outcomeColumns<SourceRow>()]}
        />
      </Section>

      <Section id="company-heading" title="By company">
        {data.byCompany.length === 0 ? (
          <p className={styles.muted}>No leads yet.</p>
        ) : (
          <DataTable<CompanyRow>
            caption="Outcomes by company"
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
        )}
      </Section>
    </>
  );
}
