import { DEMO_ACCOUNTS } from "@crm/contracts/demo";
import { describe, expect, it } from "vitest";
import { seedTargetProblem } from "./seed.js";

describe("demo seed target guard", () => {
  it.each(["crm_demo", "crm_demo_2026"])("allows an empty %s database confirmed by name", (database) => {
    expect(seedTargetProblem({ database, confirm: database, userCount: 0 })).toBeNull();
  });

  it.each(["crm", "crm_test_abc", "crm_staging", "crm_demo-prod", "neondb", "crm_demox"])("refuses %s", (database) => {
    expect(seedTargetProblem({ database, confirm: database, userCount: 0 })).toMatch(/not a crm_demo database/);
  });

  it("refuses a confirmation that does not match", () => {
    expect(seedTargetProblem({ database: "crm_demo", confirm: "crm_demo_other", userCount: 0 })).toMatch(/does not match/);
  });

  it("refuses a database that already has users", () => {
    expect(seedTargetProblem({ database: "crm_demo", confirm: "crm_demo", userCount: 1 })).toMatch(/already has users/);
  });
});

describe("demo accounts", () => {
  it("are fictional example.test accounts with unique emails and one CEO/CTO", () => {
    expect(DEMO_ACCOUNTS.every((account) => account.email.endsWith("@example.test"))).toBe(true);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.email)).size).toBe(DEMO_ACCOUNTS.length);
    expect(DEMO_ACCOUNTS.filter((account) => account.role === "ceo_cto")).toHaveLength(1);
  });
});
