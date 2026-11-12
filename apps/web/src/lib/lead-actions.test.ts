import { describe, expect, it } from "vitest";
import { activityActionsFor, canCreateLead, leadActionsFor } from "./lead-actions";

const open = { stage: "contacted" as const, archivedAt: null };
const lost = { stage: "lost" as const, archivedAt: null };
const archived = { stage: "new" as const, archivedAt: "2026-11-01T00:00:00.000Z" };

describe("leadActionsFor", () => {
  it("lets only the CGO create, edit, move and log on open leads; never to won", () => {
    expect(canCreateLead("cgo")).toBe(true);
    expect(canCreateLead("ceo_cto")).toBe(false);
    const cgo = leadActionsFor({ role: "cgo", lead: open });
    expect(cgo).toMatchObject({ canEdit: true, canMove: true, canMarkLost: true, canLogActivity: true, canReopen: false, canReassign: false });
    expect(cgo.moveTargets).toEqual(["new", "qualified", "proposal", "negotiation"]);
  });

  it("keeps the CEO read-only except for reopening lost leads and reassigning", () => {
    expect(leadActionsFor({ role: "ceo_cto", lead: open })).toMatchObject({ canEdit: false, canMove: false, moveTargets: [], canReassign: true, canReopen: false });
    expect(leadActionsFor({ role: "ceo_cto", lead: lost })).toMatchObject({ canReopen: true, canReassign: true });
    expect(leadActionsFor({ role: "cgo", lead: lost })).toMatchObject({ canEdit: false, canMove: false, canReopen: false, canArchive: true, readOnly: true });
  });

  it("makes archived leads read-only for everyone", () => {
    for (const role of ["cgo", "ceo_cto"] as const) {
      expect(leadActionsFor({ role, lead: archived })).toMatchObject({ canEdit: false, canArchive: false, canReopen: false, canReassign: false, readOnly: true });
    }
  });
});

describe("activityActionsFor", () => {
  it("lets only the CGO void, once", () => {
    expect(activityActionsFor({ role: "cgo", activity: { voidedAt: null } }).canVoid).toBe(true);
    expect(activityActionsFor({ role: "cgo", activity: { voidedAt: "2026-11-01T00:00:00.000Z" } }).canVoid).toBe(false);
    expect(activityActionsFor({ role: "ceo_cto", activity: { voidedAt: null } }).canVoid).toBe(false);
  });
});
