import { TASK_STATUSES, type TaskStatus } from "@crm/contracts/tasks";
import { describe, expect, it } from "vitest";
import { groupByStatus, groupForMyTasks, TASK_CAP_NOTICE } from "./task-view";

const tasks: { id: string; status: TaskStatus }[] = [
  { id: "1", status: "blocked" },
  { id: "2", status: "todo" },
  { id: "3", status: "completed" },
  { id: "4", status: "todo" },
  { id: "5", status: "in_review" },
  { id: "6", status: "changes_requested" },
];

describe("groupByStatus", () => {
  it("returns every status as a column, in workflow order", () => {
    expect(groupByStatus(tasks).map((column) => column.status)).toEqual([...TASK_STATUSES]);
  });

  it("puts every task in exactly one column and keeps API order within columns", () => {
    const columns = groupByStatus(tasks);
    expect(columns.flatMap((column) => column.tasks).length).toBe(tasks.length);
    expect(columns.find((column) => column.status === "todo")?.tasks.map((task) => task.id)).toEqual(["2", "4"]);
  });
});

describe("groupForMyTasks", () => {
  it("separates work that needs action from work waiting or done, keeping API order", () => {
    const { needsAction, waiting } = groupForMyTasks(tasks);
    expect(needsAction.map((task) => task.id)).toEqual(["1", "2", "4", "6"]);
    expect(waiting.map((task) => task.id)).toEqual(["3", "5"]);
  });
});

describe("TASK_CAP_NOTICE", () => {
  it("uses the agreed board text", () => {
    expect(TASK_CAP_NOTICE.board).toBe(
      "Showing the first 250 tasks. Use the overdue filter or switch to List view to filter by status.",
    );
  });
});
