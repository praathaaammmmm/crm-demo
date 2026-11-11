import { describe, expect, it } from "vitest";
import {
  canAssigneeMoveDefect,
  canManagerMoveDefect,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  DEFECT_WORKFLOW,
  defectMoveNeedsNote,
  isBlockingSeverity,
  isFinalDefect,
  qaOutcomeNeedsNote,
  QA_OUTCOMES,
  readinessNeedsNote,
  RELEASE_READINESS,
  recordQaResultRequestSchema,
  setReadinessRequestSchema,
} from "./quality.js";

describe("DEFECT_WORKFLOW", () => {
  it("treats verified and won't fix as the only final statuses", () => {
    expect(DEFECT_STATUSES.filter(isFinalDefect)).toEqual(["verified", "wont_fix"]);
  });

  it("never moves out of a final status", () => {
    for (const from of DEFECT_STATUSES.filter(isFinalDefect)) {
      for (const to of DEFECT_STATUSES) {
        expect(canAssigneeMoveDefect(from, to)).toBe(false);
        expect(canManagerMoveDefect(from, to)).toBe(false);
      }
    }
  });

  it("lets the assignee start and fix, and nothing else", () => {
    const moves = DEFECT_STATUSES.flatMap((from) => DEFECT_STATUSES.filter((to) => canAssigneeMoveDefect(from, to)).map((to) => `${from}->${to}`));
    expect(moves).toEqual(["open->in_progress", "in_progress->fixed"]);
  });

  it("lets managers verify or reopen a fix and close unfixed work as won't fix", () => {
    const moves = DEFECT_STATUSES.flatMap((from) => DEFECT_STATUSES.filter((to) => canManagerMoveDefect(from, to)).map((to) => `${from}->${to}`));
    expect(moves).toEqual(["open->wont_fix", "in_progress->wont_fix", "fixed->open", "fixed->verified"]);
  });

  it("never gives the assignee and managers the same move", () => {
    for (const from of DEFECT_STATUSES) {
      const overlap = DEFECT_WORKFLOW.assigneeMoves[from].filter((to) => DEFECT_WORKFLOW.managerMoves[from].includes(to));
      expect(overlap).toEqual([]);
    }
  });

  it("requires notes for fixed, won't fix and reopening only", () => {
    expect(defectMoveNeedsNote("in_progress", "fixed")).toBe(true);
    expect(defectMoveNeedsNote("open", "wont_fix")).toBe(true);
    expect(defectMoveNeedsNote("fixed", "open")).toBe(true);
    expect(defectMoveNeedsNote("open", "in_progress")).toBe(false);
    expect(defectMoveNeedsNote("fixed", "verified")).toBe(false);
  });
});

describe("quality rules", () => {
  it("treats only critical and high defects as blocking", () => {
    expect(DEFECT_SEVERITIES.filter(isBlockingSeverity)).toEqual(["critical", "high"]);
  });

  it("requires notes for failed and blocked QA results and for any readiness except ready", () => {
    expect(QA_OUTCOMES.filter(qaOutcomeNeedsNote)).toEqual(["failed", "blocked"]);
    expect(RELEASE_READINESS.filter(readinessNeedsNote)).toEqual(["not_ready", "at_risk"]);
    expect(recordQaResultRequestSchema.safeParse({ outcome: "failed" }).success).toBe(false);
    expect(recordQaResultRequestSchema.safeParse({ outcome: "passed" }).success).toBe(true);
    expect(setReadinessRequestSchema.safeParse({ label: "v1", readiness: "at_risk" }).success).toBe(false);
    expect(setReadinessRequestSchema.safeParse({ label: "v1", readiness: "ready" }).success).toBe(true);
  });

  it("accepts only https evidence links", () => {
    const base = { outcome: "passed" } as const;
    expect(recordQaResultRequestSchema.safeParse({ ...base, evidenceUrl: "https://example.test/run" }).success).toBe(true);
    expect(recordQaResultRequestSchema.safeParse({ ...base, evidenceUrl: "http://example.test/run" }).success).toBe(false);
    expect(recordQaResultRequestSchema.safeParse({ ...base, evidenceUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});
