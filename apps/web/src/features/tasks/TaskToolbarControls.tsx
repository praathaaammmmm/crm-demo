import { TASK_WORKFLOW, type TaskStatus } from "@crm/contracts/tasks";
import { Button } from "../../components/Button";
import { FilterBar, FilterDivider } from "../../components/FilterBar";
import { PillLink } from "../../components/Pill";
import styles from "../../components/Toolbar.module.css";
import { ViewSwitch } from "../../components/ViewSwitch";
import { hrefWith } from "../../lib/search-params";

export interface TaskFilterState {
  project: string | undefined;
  status: TaskStatus | undefined;
  overdue: boolean;
  view: "board" | "list";
}

/**
 * Only API-backed filters: project, status (list view), overdue. No search, assignee, priority or
 * sort controls, because the API cannot apply them across the full dataset.
 */
export function TaskToolbarControls({
  basePath,
  state,
  projects,
  showViewSwitch,
}: {
  basePath: string;
  state: TaskFilterState;
  /** Project options; omit on a project page, where the project is fixed. */
  projects?: { id: string; name: string }[];
  showViewSwitch: boolean;
}) {
  const params = (overrides: Partial<Record<"project" | "status" | "overdue" | "view", string | undefined>>) => ({
    project: state.project,
    status: state.view === "list" ? state.status : undefined,
    overdue: state.overdue ? "true" : undefined,
    view: showViewSwitch ? state.view : undefined,
    ...overrides,
  });
  const active = state.project !== undefined || state.status !== undefined || state.overdue;

  return (
    <FilterBar clearHref={active ? hrefWith(basePath, { view: showViewSwitch ? state.view : undefined }) : null}>
      {projects ? (
        <form method="get" action={basePath} className={styles.filterForm}>
          <label htmlFor="project-filter" className="visually-hidden">
            Project
          </label>
          <select id="project-filter" name="project" defaultValue={state.project ?? ""} className={styles.select}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {state.status && state.view === "list" ? <input type="hidden" name="status" value={state.status} /> : null}
          {state.overdue ? <input type="hidden" name="overdue" value="true" /> : null}
          {showViewSwitch ? <input type="hidden" name="view" value={state.view} /> : null}
          <Button type="submit" size="sm">
            Apply
          </Button>
        </form>
      ) : null}

      {state.view === "list" ? (
        <>
          <PillLink href={hrefWith(basePath, params({ status: undefined }))} selected={state.status === undefined}>
            All
          </PillLink>
          {TASK_WORKFLOW.columns.map((status) => (
            <PillLink key={status} href={hrefWith(basePath, params({ status }))} selected={state.status === status}>
              {TASK_WORKFLOW.statuses[status].label}
            </PillLink>
          ))}
          <FilterDivider />
        </>
      ) : null}

      <PillLink
        href={hrefWith(basePath, params({ overdue: state.overdue ? undefined : "true" }))}
        selected={state.overdue}
      >
        Overdue
      </PillLink>

      {showViewSwitch ? (
        <>
          <FilterDivider />
          <ViewSwitch current={state.view} hrefFor={(view) => hrefWith(basePath, params({ view, status: undefined }))} />
        </>
      ) : null}
    </FilterBar>
  );
}
