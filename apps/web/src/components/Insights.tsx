import Link from "next/link";
import type { ReactNode } from "react";
import { barPercent } from "../lib/growth-report-view";
import styles from "./Insights.module.css";

/** Dashboard primitives: KPI strip, panels, bar lists, action lists and compact stats. Server-safe (no client state). */

export type MetricTone = "danger" | "warning" | "success";

export interface Metric {
  label: string;
  value: string;
  /** Only set when the target route really supports the implied filter; otherwise the metric is plain text. */
  href?: string | undefined;
  /** Shown as a small dot when the metric needs attention. */
  tone?: MetricTone | undefined;
  detail?: string | undefined;
}

const TONE_CLASS: Record<MetricTone, string | undefined> = {
  danger: styles.toneDanger,
  warning: styles.toneWarning,
  success: styles.toneSuccess,
};

function MetricBody({ metric, size }: { metric: Metric; size: "kpi" | "stat" }) {
  return (
    <>
      <span className={styles.metricLabel}>
        {metric.tone ? <span className={[styles.dot, TONE_CLASS[metric.tone]].join(" ")} aria-hidden="true" /> : null}
        {metric.label}
      </span>
      <span className={size === "kpi" ? styles.kpiValue : styles.statValue}>{metric.value}</span>
      {metric.detail ? <span className={styles.metricDetail}>{metric.detail}</span> : null}
    </>
  );
}

function MetricCell({ metric, size }: { metric: Metric; size: "kpi" | "stat" }) {
  const className = size === "kpi" ? styles.kpi : styles.stat;
  return metric.href === undefined ? (
    <div className={className}>
      <MetricBody metric={metric} size={size} />
    </div>
  ) : (
    <Link href={metric.href} className={[className, styles.metricLink].join(" ")}>
      <MetricBody metric={metric} size={size} />
    </Link>
  );
}

/** The 3–5 headline metrics at the top of a dashboard, as one joined strip (not separate cards). */
export function KpiStrip({ label, metrics }: { label: string; metrics: Metric[] }) {
  return (
    <section className={styles.kpiStrip} aria-label={label}>
      {metrics.map((metric) => (
        <MetricCell key={metric.label} metric={metric} size="kpi" />
      ))}
    </section>
  );
}

/** Secondary metrics: smaller values in a dense grid, used inside a Panel. */
export function StatGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className={styles.statGrid}>
      {metrics.map((metric) => (
        <MetricCell key={metric.label} metric={metric} size="stat" />
      ))}
    </div>
  );
}

/** A titled surface. The heading labels the region for assistive technology. */
export function Panel({
  id,
  title,
  action,
  flush = false,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  /** Remove body padding (for tables and lists that draw their own rows). */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <div className={styles.panelHeader}>
        <h2 id={id} className={styles.panelTitle}>
          {title}
        </h2>
        {action ? <div className={styles.panelAction}>{action}</div> : null}
      </div>
      <div className={flush ? styles.panelBodyFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

/** Main column (chart, table) and side column (action list); a single column on narrow screens. */
export function DashboardGrid({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className={styles.grid}>
      <div className={styles.main}>{main}</div>
      <div className={styles.side}>{side}</div>
    </div>
  );
}

/** A quiet heading separating lower-priority sections. */
export function SectionDivider({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className={styles.divider}>
      <h2 id={id} className={styles.dividerTitle}>
        {title}
      </h2>
      {action}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Printed beside the bar: the bar is never the only signal. */
  text: string;
}

/**
 * Horizontal bars with labels and printed values. `label` names the list for assistive technology.
 * `total` adds a one-line total above the bars (e.g. "10 tasks"), so shares have a visible base.
 */
export function BarList({ label, rows, legend, total }: { label: string; rows: BarRow[]; legend?: string; total?: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  return (
    <>
      {total ? <p className={styles.chartTotal}>{total}</p> : null}
      <ul className={styles.bars} aria-label={label}>
        {rows.map((row) => (
          <li key={row.key} className={styles.barRow} title={`${row.label}: ${row.text}`}>
            <span className={styles.barLabel}>{row.label}</span>
            <span className={styles.barTrack} aria-hidden="true">
              <span className={styles.barFill} style={{ width: `${String(barPercent(row.value, max))}%` }} />
            </span>
            <span className={styles.barValue}>{row.text}</span>
          </li>
        ))}
      </ul>
      {legend ? <p className={styles.legend}>{legend}</p> : null}
    </>
  );
}

/** Responsive grid of chart panels: one column on narrow screens, two or three where they fit. */
export function ChartGrid({ children }: { children: ReactNode }) {
  return <div className={styles.chartGrid}>{children}</div>;
}

export interface ActionItem {
  key: string;
  title: string;
  href: string;
  meta?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  tone?: MetricTone | undefined;
}

/** Compact rows of things that need someone to act. */
export function ActionList({ label, items, empty }: { label: string; items: ActionItem[]; empty: string }) {
  if (items.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.actions} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={styles.actionRow}>
          <span className={[styles.dot, item.tone ? TONE_CLASS[item.tone] : styles.toneNeutral].join(" ")} aria-hidden="true" />
          <span className={styles.actionMain}>
            <Link href={item.href} className={styles.actionTitle}>
              {item.title}
            </Link>
            {item.meta ? <span className={styles.actionMeta}>{item.meta}</span> : null}
          </span>
          {item.trailing ? <span className={styles.actionTrailing}>{item.trailing}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Quiet inline empty message for a panel body. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
