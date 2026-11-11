import { describe, expect, it } from "vitest";
import { can } from "./can.js";
import { ASSIGNABLE_ROLES, ROLES } from "./roles.js";

describe("roles", () => {
  it("ASSIGNABLE_ROLES is every role except ceo_cto", () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(ROLES.filter((role) => role !== "ceo_cto").sort());
  });
});

describe("can", () => {
  it("denies unknown permissions for every role, including the Super Admin", () => {
    for (const role of ROLES) {
      expect(can({ role }, "users:delete_everything")).toBe(false);
      expect(can({ role }, "")).toBe(false);
    }
  });

  it("gives assignee-only roles nothing beyond their own tasks", () => {
    for (const role of ["founder", "employee", "intern", "contractor"] as const) {
      expect(can({ role }, "users:read_directory")).toBe(false);
      expect(can({ role }, "approvals:decide")).toBe(false);
      expect(can({ role }, "tasks:read_all")).toBe(false);
      expect(can({ role }, "tasks:read_assigned")).toBe(true);
      expect(can({ role }, "tasks:update_assigned")).toBe(true);
      expect(can({ role }, "quality:read_assigned")).toBe(true);
      expect(can({ role }, "quality:respond_assigned")).toBe(true);
      expect(can({ role }, "quality:read_all")).toBe(false);
      expect(can({ role }, "quality:manage")).toBe(false);
    }
  });

  it("lets every role read and answer its own meetings and notifications; only the CEO/CTO manages or reads all meetings", () => {
    for (const role of ROLES) {
      expect(can({ role }, "meetings:read_invited")).toBe(true);
      expect(can({ role }, "meetings:respond")).toBe(true);
      expect(can({ role }, "notifications:read_own")).toBe(true);
      expect(can({ role }, "meetings:manage")).toBe(role === "ceo_cto");
      expect(can({ role }, "meetings:read_all")).toBe(role === "ceo_cto");
    }
  });

  it("allows only the CEO/CTO to decide approvals, create users, and create, manage and review tasks", () => {
    for (const role of ROLES) {
      for (const permission of [
        "approvals:decide",
        "users:create",
        "projects:create",
        "tasks:create",
        "tasks:manage",
        "tasks:review",
      ]) {
        expect(can({ role }, permission)).toBe(role === "ceo_cto");
      }
    }
  });

  it("gives VP Engineering & Quality read-only access to all tasks and projects, and quality management", () => {
    const vp = { role: "vp_engineering_quality" } as const;
    for (const permission of ["tasks:read_all", "projects:read_all", "quality:read_all", "quality:manage"]) {
      expect(can(vp, permission)).toBe(true);
    }
    for (const permission of ["tasks:create", "tasks:manage", "tasks:review", "projects:create"]) {
      expect(can(vp, permission)).toBe(false);
    }
  });

  it("limits reading all tasks, projects and quality items to the CEO/CTO and VP Engineering & Quality", () => {
    for (const role of ROLES) {
      for (const permission of ["tasks:read_all", "projects:read_all", "quality:read_all", "quality:manage"]) {
        expect(can({ role }, permission)).toBe(role === "ceo_cto" || role === "vp_engineering_quality");
      }
    }
  });
});
