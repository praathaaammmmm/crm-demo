import type { ReportRange } from "@crm/contracts/growth-reports";
import { buttonClass } from "../../components/Button";
import { FilterBar } from "../../components/FilterBar";
import { PillLink } from "../../components/Pill";
import { overviewHref, rangePresets } from "../../lib/growth-report-view";
import styles from "./Growth.module.css";

/** Preset links plus a plain GET form, so a range works without client JavaScript and can be shared. */
export function DateRangeFilter({ range, today }: { range: ReportRange | null; today: string | null }) {
  const presets = today === null ? [] : rangePresets(today);
  const isDefault = range !== null && today !== null && presets[1]?.from === range.from && range.to === today;
  return (
    <div className={styles.rangeBar}>
      {presets.length > 0 ? (
        <FilterBar clearHref={isDefault ? null : overviewHref()}>
          {presets.map((preset) => (
            <PillLink key={preset.label} href={overviewHref(preset)} selected={range?.from === preset.from && range.to === preset.to}>
              {preset.label}
            </PillLink>
          ))}
        </FilterBar>
      ) : null}
      <form method="get" action="/growth" className={styles.rangeForm} aria-label="Date range">
        <label>
          From
          <input type="date" name="from" defaultValue={range?.from} max={today ?? undefined} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={range?.to} max={today ?? undefined} />
        </label>
        <button type="submit" className={buttonClass("secondary", "sm")}>
          Apply
        </button>
      </form>
    </div>
  );
}
