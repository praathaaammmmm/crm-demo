import { TASK_STATUSES, type TaskStatus } from "@crm/contracts/tasks";
import { describe, expect, it } from "vitest";
import { isSafeProofUrl, taskActionsFor } from "./task-actions";

const ME = "0196f3a0-0000-7000-8000-000000000001";
const OTHER = "0196f3a0-0000-7000-8000-000000000002";

const asAssignee = (status: TaskStatus, proofCount = 0) =>
  taskActionsFor({ role: "employee", viewerId: ME, task: { status, assigneeId: ME }, proofCount });
const asCeo = (status: TaskStatus) =>
  taskActionsFor({ role: "ceo_cto", viewerId: OTHER, task: { status, assigneeId: ME }, proofCount: 1 });

describe("taskActionsFor: assignee", () => {
  it.each([
    ["todo", ["Start"]],
    ["in_progress", ["Mark blocked"]],
    ["blocked", ["Resume"]],
    ["changes_requested", ["Resume"]],
    ["in_review", []],
    ["completed", []],
  ] as [TaskStatus, string[]][])("%s shows exactly %j", (status, labels) => {
    expect(asAssignee(status).moves.map((move) => move.label)).toEqual(labels);
  });

  it("asks for a note only when marking blocked", () => {
    for (const status of TASK_STATUSES) {
      for (const move of asAssignee(status).moves) expect(move.needsNote).toBe(move.to === "blocked");
    }
  });

  it("offers Submit only from in_progress or changes_requested, and only with a proof", () => {
    for (const status of TASK_STATUSES) {
      const submittable = status === "in_progress" || status === "changes_requested";
      expect(asAssignee(status, 1).canSubmit).toBe(submittable);
      expect(asAssignee(status, 0).canSubmit).toBe(false);
      expect(asAssignee(status, 0).submitHint !== null).toBe(submittable);
    }
  });

  it("gives an assignee no review, completion or edit actions", () => {
    const actions = asAssignee("in_review", 1);
    expect([actions.canReview, actions.canMarkComplete, actions.canEdit]).toEqual([false, false, false]);
  });

  it("makes a completed task read-only", () => {
    expect(asAssignee("completed", 1)).toMatchObject({ readOnly: true, canAddUpdates: false, canSubmit: false, moves: [] });
  });

  it("gives someone who is not the assignee nothing", () => {
    const actions = taskActionsFor({ role: "cfo", viewerId: OTHER, task: { status: "in_progress", assigneeId: ME }, proofCount: 1 });
    expect(actions).toMatchObject({ isAssignee: false, moves: [], canAddUpdates: false, canSubmit: false, canReview: false });
  });
});

describe("taskActionsFor: CEO/CTO", () => {
  it("reviews only tasks in review, completes any open task, edits open tasks", () => {
    for (const status of TASK_STATUSES) {
      const actions = asCeo(status);
      expect(actions.canReview).toBe(status === "in_review");
      expect(actions.canMarkComplete).toBe(status !== "completed");
      expect(actions.canEdit).toBe(status !== "completed");
      expect(actions.moves).toEqual([]);
    }
  });
});

describe("isSafeProofUrl", () => {
  it("accepts only valid https URLs", () => {
    expect(isSafeProofUrl("https://example.test/report")).toBe(true);
    expect(isSafeProofUrl("http://example.test/report")).toBe(false);
    expect(isSafeProofUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeProofUrl("https://")).toBe(false);
    expect(isSafeProofUrl(null)).toBe(false);
  });
});
