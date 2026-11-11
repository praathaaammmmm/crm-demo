import { describe, expect, it } from "vitest";
import {
  canAssigneeMove,
  canCompleteFrom,
  canReviewFrom,
  canSubmitFrom,
  isOpenStatus,
  statusLabel,
  TASK_STATUSES,
  TASK_WORKFLOW,
} from "./tasks.js";

describe("TASK_WORKFLOW", () => {
  it("uses the task status order for Kanban columns", () => {
    expect([...TASK_WORKFLOW.columns]).toEqual([...TASK_STATUSES]);
  });

  it("labels every status", () => {
    for (const status of TASK_STATUSES) expect(statusLabel(status).length).toBeGreaterThan(0);
  });

  it("treats completed as the only final status", () => {
    expect(TASK_STATUSES.filter((status) => !isOpenStatus(status))).toEqual(["completed"]);
  });

  it("never moves out of completed", () => {
    for (const to of TASK_STATUSES) expect(canAssigneeMove("completed", to)).toBe(false);
    expect(canSubmitFrom("completed")).toBe(false);
    expect(canReviewFrom("completed")).toBe(false);
    expect(canCompleteFrom("completed")).toBe(false);
  });

  it("keeps in_review and completed out of direct assignee moves", () => {
    for (const from of TASK_STATUSES) {
      expect(canAssigneeMove(from, "in_review")).toBe(false);
      expect(canAssigneeMove(from, "completed")).toBe(false);
    }
  });

  it("allows submit and review only from open statuses", () => {
    for (const status of [...TASK_WORKFLOW.submittableFrom, ...TASK_WORKFLOW.reviewableFrom]) {
      expect(isOpenStatus(status)).toBe(true);
    }
    expect([...TASK_WORKFLOW.submittableFrom]).toEqual(["in_progress", "changes_requested"]);
    expect([...TASK_WORKFLOW.reviewableFrom]).toEqual(["in_review"]);
  });

  it("maps review decisions to their resulting status", () => {
    expect(TASK_WORKFLOW.reviewOutcome).toEqual({ approved: "completed", changes_requested: "changes_requested" });
  });

  it("only requires notes for moves an assignee can actually make", () => {
    const reachable = new Set(TASK_STATUSES.flatMap((from) => TASK_WORKFLOW.assigneeMoves[from]));
    for (const status of TASK_WORKFLOW.noteRequiredOn) expect(reachable.has(status)).toBe(true);
  });
});
