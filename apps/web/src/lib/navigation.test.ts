import type { Role } from "@crm/permissions";
import { describe, expect, it } from "vitest";
import { navigationFor, navItemsFor } from "./navigation";

const REQUESTER = ["Home", "My tasks", "Projects", "Defects", "Users", "Approvals"];
const ASSIGNEE = ["Home", "My tasks", "Projects", "Defects"];
const EXPECTED: Record<Role, string[]> = {
  ceo_cto: ["Dashboard", "Tasks", "Projects", "Review", "Quality", "Defects", "Users", "Approvals"],
  cfo: REQUESTER,
  cgo: REQUESTER,
  cmo: REQUESTER,
  vp_engineering_quality: ["Home", "Tasks", "Projects", "Quality", "Defects", "Users", "Approvals"],
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
    expect(navigationFor("ceo_cto").map((section) => section.title)).toEqual(["Workspace", "Operations", "Administration"]);
    expect(navigationFor("employee").map((section) => section.title)).toEqual(["Workspace", "Operations"]);
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
