import type { Role } from "@crm/permissions";
import { describe, expect, it } from "vitest";
import { navigationFor, navItemsFor } from "./navigation";

const REQUESTER = ["Home", "My tasks", "Meetings", "Projects", "Defects", "Users", "Approvals"];
const ASSIGNEE = ["Home", "My tasks", "Meetings", "Projects", "Defects"];
const EXPECTED: Record<Role, string[]> = {
  ceo_cto: ["Dashboard", "Tasks", "Meetings", "Projects", "Review", "Quality", "Defects", "Overview", "Leads", "Companies", "Proposals", "Approval queue",
    "Marketing overview", "Campaigns", "Content calendar", "Ops overview", "Incidents", "Releases", "Automations", "Users", "Approvals"],
  cfo: REQUESTER,
  cgo: ["Home", "My tasks", "Meetings", "Projects", "Defects", "Overview", "Leads", "Companies", "Proposals", "Users", "Approvals"],
  cmo: ["Home", "My tasks", "Meetings", "Projects", "Defects", "Marketing overview", "Campaigns", "Content calendar", "Users", "Approvals"],
  vp_engineering_quality: ["Home", "Tasks", "Meetings", "Projects", "Quality", "Defects", "Ops overview", "Incidents", "Releases", "Automations", "Users", "Approvals"],
  founder: ASSIGNEE,
  employee: ASSIGNEE,
  intern: ASSIGNEE,
  contractor: ASSIGNEE,
};

describe("navigationFor", () => {
  it.each(Object.entries(EXPECTED) as [Role, string[]][])("%s sees exactly its items, in order", (role, labels) => {
    expect(navItemsFor(role).map((item) => item.label)).toEqual(labels);
  });

  it("groups items into Workspace, Operations and Administration, omitting empty sections", () => {
    expect(navigationFor("ceo_cto").map((section) => section.title)).toEqual(["Workspace", "Operations", "Growth", "Marketing", "Engineering", "Administration"]);
    expect(navigationFor("cmo").map((section) => section.title)).toEqual(["Workspace", "Operations", "Marketing", "Administration"]);
    expect(navigationFor("vp_engineering_quality").map((section) => section.title)).toEqual(["Workspace", "Operations", "Engineering", "Administration"]);
    expect(navigationFor("cfo").map((section) => section.title)).toEqual(["Workspace", "Operations", "Administration"]);
    expect(navigationFor("employee").map((section) => section.title)).toEqual(["Workspace", "Operations"]);
  });

  it("shows Growth only to the CEO/CTO and the CGO", () => {
    for (const role of Object.keys(EXPECTED) as Role[]) {
      expect(navItemsFor(role).some((item) => item.href === "/growth")).toBe(role === "ceo_cto" || role === "cgo");
      expect(navItemsFor(role).some((item) => item.href === "/growth/companies")).toBe(role === "ceo_cto" || role === "cgo");
      expect(navItemsFor(role).some((item) => item.href === "/growth/leads")).toBe(role === "ceo_cto" || role === "cgo");
      expect(navItemsFor(role).some((item) => item.href === "/growth/proposals")).toBe(role === "ceo_cto" || role === "cgo");
      expect(navItemsFor(role).some((item) => item.href === "/growth/proposals/queue")).toBe(role === "ceo_cto");
    }
  });

  it("shows Marketing only to the CEO/CTO and the CMO, and Engineering operations only to the CEO/CTO and the VP", () => {
    for (const role of Object.keys(EXPECTED) as Role[]) {
      const hrefs: string[] = navItemsFor(role).map((item) => item.href);
      for (const href of ["/marketing", "/marketing/campaigns", "/marketing/content"]) expect(hrefs.includes(href)).toBe(role === "ceo_cto" || role === "cmo");
      for (const href of ["/operations", "/operations/incidents", "/operations/releases", "/operations/automations"]) {
        expect(hrefs.includes(href)).toBe(role === "ceo_cto" || role === "vp_engineering_quality");
      }
    }
  });

  it("shows Review only to the CEO/CTO", () => {
    for (const role of Object.keys(EXPECTED) as Role[]) {
      expect(navItemsFor(role).some((item) => item.href === "/review")).toBe(role === "ceo_cto");
    }
  });

  it("shows Quality only to the CEO/CTO and VP Engineering & Quality, and Defects to every role with tasks", () => {
    for (const role of Object.keys(EXPECTED) as Role[]) {
      const hrefs = navItemsFor(role).map((item) => item.href);
      expect(hrefs.includes("/quality")).toBe(role === "ceo_cto" || role === "vp_engineering_quality");
      expect(hrefs.includes("/defects")).toBe(true);
    }
  });
});
