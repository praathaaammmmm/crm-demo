import { TASK_WORKFLOW, type TaskStatus } from "@crm/contracts/tasks";

/** Grouping and cap-notice helpers. Order within every group is the API's order; nothing is re-sorted here. */

export function groupByStatus<T extends { status: TaskStatus }>(tasks: readonly T[]): { status: TaskStatus; tasks: T[] }[] {
  return TASK_WORKFLOW.columns.map((status) => ({ status, tasks: tasks.filter((task) => task.status === status) }));
}

const NEEDS_ACTION: readonly TaskStatus[] = ["todo", "in_progress", "blocked", "changes_requested"];

/** My tasks: what the assignee should act on, then what is waiting on review or done. */
export function groupForMyTasks<T extends { status: TaskStatus }>(tasks: readonly T[]): { needsAction: T[]; waiting: T[] } {
  return {
    needsAction: tasks.filter((task) => NEEDS_ACTION.includes(task.status)),
    waiting: tasks.filter((task) => !NEEDS_ACTION.includes(task.status)),
  };
}

export const TASK_CAP_NOTICE = {
  board: "Showing the first 250 tasks. Use the overdue filter or switch to List view to filter by status.",
  list: "Showing the first 250 tasks. Use the filters to narrow the view.",
  review: "Showing the first 250 tasks awaiting review.",
  projects: "Showing the first 250 projects.",
  projectOptions: "Only the first 250 projects are listed in this filter.",
  names: "Some names may show as Unknown user.",
  people: "Only the first 250 people are listed.",
  qualityProjects: "Showing the first 250 projects with blockers. Tile counts above include every project.",
  defects: "Showing the first 250 defects. Use the filters to narrow the view.",
  taskOptions: "Only the first 250 tasks are listed in this picker.",
  meetings: "Showing the first 250 meetings in this range. Use a shorter range or the status filter.",
  notifications: "Showing the latest 250 notifications.",
  leads: "Showing the first 250 leads. Use the filters to narrow the view.",
  activities: "Showing the latest 250 activities.",
  companies: "Showing the first 250 companies.",
  contacts: "Showing the first 250 contacts for this company.",
} as const;
