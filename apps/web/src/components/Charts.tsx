import styles from "./Charts.module.css";
import { BarList, type BarRow } from "./Insights";

/** Categorical slots, in fixed order. Validated for the dark surface; always paired with a text legend. */
const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;
export const DONUT_MAX_CATEGORIES = SLOTS.length;

/** A legend row: swatch, label and the same printed figures as the chart (count · share). */
function Legend({ label, rows }: { label: string; rows: readonly (BarRow & { color: string })[] }) {
  return (
    <ul className={styles.legend} aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={styles.legendRow} title={`${row.label}: ${row.text}`}>
          <span className={styles.swatch} style={{ background: row.color }} aria-hidden="true" />
          <span className={styles.legendLabel}>{row.label}</span>
          <span className={styles.legendValue}>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

const RADIUS = 40;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Surface-coloured gap between segments, in px of arc. */
const GAP = 2;

/**
 * Part-of-whole for a small distribution (2–5 non-zero categories): an SVG ring plus a legend with label, count
 * and share for every segment. Anything else (one category, or more than five) falls back to labelled bars,
 * where a donut would not read well. Rows should already hide zero categories.
 */
export function DonutChart({ label, rows, total, centerLabel }: { label: string; rows: BarRow[]; total?: string; centerLabel: string }) {
  const visible = rows.filter((row) => row.value > 0);
  if (visible.length < 2 || visible.length > DONUT_MAX_CATEGORIES) return <BarList label={label} rows={rows} {...(total ? { total } : {})} />;

  const sum = visible.reduce((acc, row) => acc + row.value, 0);
  const coloured = visible.map((row, index) => ({ ...row, color: SLOTS[index] ?? SLOTS[0] }));
  let offset = 0;
  const segments = coloured.map((row) => {
    const length = (row.value / sum) * CIRCUMFERENCE;
    const segment = { ...row, dash: Math.max(length - GAP, 0.5), offset };
    offset += length;
    return segment;
  });
  const summary = `${label}: ${coloured.map((row) => `${row.label} ${row.text}`).join(", ")}`;

  return (
    <div className={styles.donutWrap}>
      {total ? <p className={styles.total}>{total}</p> : null}
      <div className={styles.donutLayout}>
        <svg className={styles.donut} viewBox="0 0 100 100" role="img" aria-label={summary}>
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--color-surface-sunken)" strokeWidth={STROKE} />
          {segments.map((segment) => (
            <circle
              key={segment.key}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth={STROKE}
              strokeDasharray={`${String(segment.dash)} ${String(CIRCUMFERENCE)}`}
              strokeDashoffset={-segment.offset}
              transform="rotate(-90 50 50)"
            >
              <title>{`${segment.label}: ${segment.text}`}</title>
            </circle>
          ))}
          <text x="50" y="49" textAnchor="middle" className={styles.centerValue}>
            {String(sum)}
          </text>
          <text x="50" y="62" textAnchor="middle" className={styles.centerLabel}>
            {centerLabel}
          </text>
        </svg>
        <Legend label={label} rows={coloured} />
      </div>
    </div>
  );
}

/**
 * Complete vs remaining as one stacked bar, with exact "x of y" text and a two-row legend.
 * `total` 0 shows the text only (there is nothing to complete).
 */
export function StackedProgress({ label, done, total }: { label: string; done: number; total: number }) {
  const remaining = Math.max(total - done, 0);
  const share = total > 0 ? Math.round((done / total) * 100) : null;
  const text = share === null ? "No checklist items" : `${String(done)} of ${String(total)} complete · ${String(share)}%`;
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span className={styles.progressLabel}>{label}</span>
        <span className={styles.legendValue}>{text}</span>
      </div>
      {total > 0 ? (
        <>
          <div className={styles.stack} role="img" aria-label={`${label}: ${text}, ${String(remaining)} remaining`}>
            {done > 0 ? <span className={styles.stackDone} style={{ flexGrow: done }} title={`Complete: ${String(done)}`} /> : null}
            {remaining > 0 ? <span className={styles.stackRemaining} style={{ flexGrow: remaining }} title={`Remaining: ${String(remaining)}`} /> : null}
          </div>
          <ul className={styles.inlineLegend} aria-label={`${label} legend`}>
            <li>
              <span className={styles.swatch} style={{ background: "var(--color-accent)" }} aria-hidden="true" />
              <span>Complete</span>
              <span className={styles.legendValue}>{String(done)}</span>
            </li>
            <li>
              <span className={styles.swatch} style={{ background: "var(--chart-remaining)" }} aria-hidden="true" />
              <span>Remaining</span>
              <span className={styles.legendValue}>{String(remaining)}</span>
            </li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
