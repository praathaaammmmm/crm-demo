import { describe, expect, it } from "vitest";
import { automationActions, incidentMoveTargets, releaseActions } from "./operations-view";

const VP = { manage: true, approve: false };
const CEO = { manage: false, approve: true };

describe("operations view", () => {
  it("incident moves exclude resolving, which has its own form", () => {
    expect(incidentMoveTargets("open")).toEqual(["investigating", "mitigated"]);
    expect(incidentMoveTargets("resolved")).toEqual([]);
  });

  it("shows release actions by role: the VP records work, the CEO/CTO approves production", () => {
    expect(releaseActions("production", "draft", VP).map((a) => a.to)).toEqual(["awaiting_approval"]);
    expect(releaseActions("production", "draft", CEO)).toEqual([]);
    expect(releaseActions("production", "awaiting_approval", VP)).toEqual([]);
    expect(releaseActions("production", "awaiting_approval", CEO).map((a) => [a.to, a.needsNote])).toEqual([
      ["approved", false],
      ["rejected", true],
    ]);
    expect(releaseActions("staging", "draft", VP).map((a) => a.to)).toEqual(["deployed", "failed"]);
    expect(releaseActions("production", "deployed", VP)).toEqual([{ to: "rolled_back", label: "Record rollback", needsNote: true, danger: true }]);
  });

  it("shows automation actions by role: go-live decisions are the CEO/CTO's", () => {
    expect(automationActions("testing", VP).map((a) => a.to)).toEqual(["draft", "awaiting_approval", "retired"]);
    expect(automationActions("awaiting_approval", VP).map((a) => a.to)).toEqual(["retired"]);
    expect(automationActions("awaiting_approval", CEO).map((a) => [a.label, a.needsNote])).toEqual([
      ["Send back to testing", true],
      ["Approve go-live", false],
    ]);
    expect(automationActions("paused", VP).map((a) => a.label)).toEqual(["Resume", "Retire"]);
    expect(automationActions("retired", VP)).toEqual([]);
  });
});
