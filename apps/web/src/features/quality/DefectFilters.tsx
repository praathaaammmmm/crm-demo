import { DEFECT_SEVERITIES, DEFECT_STATUSES, defectStatusLabel, severityLabel, type DefectSeverity, type DefectStatus } from "@crm/contracts/quality";
import { Button } from "../../components/Button";
import { FilterBar, FilterDivider } from "../../components/FilterBar";
import { PillLink } from "../../components/Pill";
import styles from "../../components/Toolbar.module.css";
import { hrefWith } from "../../lib/search-params";

export interface DefectFilterState {
  project: string | undefined;
  severity: DefectSeverity | undefined;
  status: DefectStatus | undefined;
  open: boolean;
}

type Key = "project" | "severity" | "status" | "open";

/** Only API-backed filters: project, severity, status and open. No search, assignee or sort controls. */
export function DefectFilters({
  state,
  projects,
}: {
  state: DefectFilterState;
  projects: { id: string; name: string }[];
}) {
  const basePath = "/defects";
  const params = (overrides: Partial<Record<Key, string | undefined>>) => ({
    project: state.project,
    severity: state.severity,
    status: state.status,
    open: state.open ? "true" : undefined,
    ...overrides,
  });
  const active = state.project !== undefined || state.severity !== undefined || state.status !== undefined || state.open;

  return (
    <FilterBar clearHref={active ? basePath : null}>
      <form method="get" action={basePath} className={styles.filterForm}>
        <label htmlFor="defect-project-filter" className="visually-hidden">
          Project
        </label>
        <select id="defect-project-filter" name="project" defaultValue={state.project ?? ""} className={styles.select}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {state.severity ? <input type="hidden" name="severity" value={state.severity} /> : null}
        {state.status ? <input type="hidden" name="status" value={state.status} /> : null}
        {state.open ? <input type="hidden" name="open" value="true" /> : null}
        <Button type="submit" size="sm">
          Apply
        </Button>
      </form>

      <PillLink href={hrefWith(basePath, params({ open: state.open ? undefined : "true", status: undefined }))} selected={state.open}>
        Open
      </PillLink>
      <FilterDivider />

      {DEFECT_SEVERITIES.map((severity) => (
        <PillLink
          key={severity}
          href={hrefWith(basePath, params({ severity: state.severity === severity ? undefined : severity }))}
          selected={state.severity === severity}
        >
          {severityLabel(severity)}
        </PillLink>
      ))}
      <FilterDivider />

      {DEFECT_STATUSES.map((status) => (
        <PillLink
          key={status}
          href={hrefWith(basePath, params({ status: state.status === status ? undefined : status, open: undefined }))}
          selected={state.status === status}
        >
          {defectStatusLabel(status)}
        </PillLink>
      ))}
    </FilterBar>
  );
}
