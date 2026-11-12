import { describe, expect, it } from "vitest";
import { canCreateCompany, companyActionsFor, contactActionsFor } from "./growth-actions";

const live = { archivedAt: null };
const archived = { archivedAt: "2026-11-12T10:00:00.000Z" };

describe("growth actions", () => {
  it("lets only the CGO create and change companies, and nothing on archived ones", () => {
    expect(canCreateCompany("cgo")).toBe(true);
    expect(canCreateCompany("ceo_cto")).toBe(false);
    expect(companyActionsFor({ role: "cgo", company: live })).toEqual({ canEdit: true, canArchive: true, canAddContact: true, readOnly: false });
    expect(companyActionsFor({ role: "cgo", company: archived })).toEqual({ canEdit: false, canArchive: false, canAddContact: false, readOnly: true });
    expect(companyActionsFor({ role: "ceo_cto", company: live })).toMatchObject({ canEdit: false, canArchive: false, canAddContact: false });
  });

  it("hides every contact write when the contact or its company is archived", () => {
    const cases = [
      [{ archivedAt: null, companyArchived: false }, true],
      [{ archivedAt: null, companyArchived: true }, false],
      [{ archivedAt: "2026-11-12T10:00:00.000Z", companyArchived: false }, false],
    ] as const;
    for (const [contact, writable] of cases) {
      expect(contactActionsFor({ role: "cgo", contact })).toEqual({
        canEdit: writable,
        canArchive: writable,
        canToggleDoNotContact: writable,
        readOnly: !writable,
      });
    }
    expect(contactActionsFor({ role: "ceo_cto", contact: { archivedAt: null, companyArchived: false } }).canEdit).toBe(false);
    expect(contactActionsFor({ role: "cfo", contact: { archivedAt: null, companyArchived: false } }).canEdit).toBe(false);
  });
});
