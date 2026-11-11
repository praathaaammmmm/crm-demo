import type { DefectStatus } from "@crm/contracts/quality";
import type { Role } from "@crm/permissions";
import { describe, expect, it } from "vitest";
import { canManageQualityFor, defectActionsFor } from "./defect-actions";

const ASSIGNEE = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";

const labels = (role: Role, viewerId: string, status: DefectStatus) =>
  defectActionsFor({ role, viewerId, defect: { status, assigneeId: ASSIGNEE } }).moves.map((move) => move.label);

describe("defectActionsFor: assignee", () => {
  it.each([
    ["open", ["Start fix"]],
    ["in_progress", ["Mark fixed"]],
    ["fixed", []],
    ["verified", []],
    ["wont_fix", []],
  ] as const)("%s shows exactly %j", (status, expected) => {
    expect(labels("employee", ASSIGNEE, status)).toEqual(expected);
  });

  it("asks for a note when marking fixed", () => {
    const actions = defectActionsFor({ role: "employee", viewerId: ASSIGNEE, defect: { status: "in_progress", assigneeId: ASSIGNEE } });
    expect(actions.moves).toEqual([{ to: "fixed", label: "Mark fixed", needsNote: true, primary: true }]);
    expect(actions).toMatchObject({ canRespond: true, canEdit: false, readOnly: false });
  });

  it("gives someone who is not the assignee nothing", () => {
    expect(defectActionsFor({ role: "cfo", viewerId: OTHER, defect: { status: "open", assigneeId: ASSIGNEE } })).toEqual({
      moves: [],
      canRespond: false,
      canEdit: false,
      readOnly: false,
      ownTaskNotice: false,
    });
  });
});

describe("defectActionsFor: managers", () => {
  it.each(["ceo_cto", "vp_engineering_quality"] as const)("%s verifies or reopens a fix and can close unfixed work", (role) => {
    expect(labels(role, OTHER, "fixed")).toEqual(["Reopen", "Verify fix"]);
    expect(labels(role, OTHER, "open")).toEqual(["Won't fix"]);
    expect(labels(role, OTHER, "in_progress")).toEqual(["Won't fix"]);
    const actions = defectActionsFor({ role, viewerId: OTHER, defect: { status: "open", assigneeId: ASSIGNEE } });
    expect(actions).toMatchObject({ canRespond: true, canEdit: true, readOnly: false, ownTaskNotice: false });
  });

  it("self-QA conflict: on their own task VP gets only assignee moves, can respond, and cannot edit", () => {
    expect(labels("vp_engineering_quality", ASSIGNEE, "open")).toEqual(["Start fix"]);
    expect(labels("vp_engineering_quality", ASSIGNEE, "in_progress")).toEqual(["Mark fixed"]);
    expect(labels("vp_engineering_quality", ASSIGNEE, "fixed")).toEqual([]);
    const actions = defectActionsFor({
      role: "vp_engineering_quality",
      viewerId: ASSIGNEE,
      defect: { status: "open", assigneeId: ASSIGNEE },
    });
    expect(actions).toMatchObject({ canRespond: true, canEdit: false, ownTaskNotice: true });
  });

  it("canManageQualityFor: managers except on their own task; never assignee-only roles", () => {
    expect(canManageQualityFor({ role: "vp_engineering_quality", viewerId: OTHER, assigneeId: ASSIGNEE })).toBe(true);
    expect(canManageQualityFor({ role: "vp_engineering_quality", viewerId: ASSIGNEE, assigneeId: ASSIGNEE })).toBe(false);
    expect(canManageQualityFor({ role: "ceo_cto", viewerId: OTHER, assigneeId: ASSIGNEE })).toBe(true);
    expect(canManageQualityFor({ role: "employee", viewerId: ASSIGNEE, assigneeId: ASSIGNEE })).toBe(false);
    expect(canManageQualityFor({ role: "cfo", viewerId: OTHER, assigneeId: ASSIGNEE })).toBe(false);
  });

  it("makes final defects read-only for everyone", () => {
    for (const status of ["verified", "wont_fix"] as const) {
      const actions = defectActionsFor({ role: "ceo_cto", viewerId: OTHER, defect: { status, assigneeId: ASSIGNEE } });
      expect(actions).toEqual({ moves: [], canRespond: false, canEdit: false, readOnly: true, ownTaskNotice: false });
    }
  });
});
