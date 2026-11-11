import type { Role } from "@crm/permissions";
import { describe, expect, it } from "vitest";
import type { AuthSession } from "../../platform/context.js";
import { AppError } from "../../platform/errors.js";
import { assertCanManageFor, assertCanMove, assertCanRespond, assertCanSetReadiness } from "./quality.policy.js";

// Pure policy checks: no database or app.

const userOf = (id: string, role: Role): AuthSession["user"] => ({
  id,
  email: `${id}@example.test`,
  name: id,
  role,
  isSuperAdmin: role === "ceo_cto",
  mustChangePassword: false,
});

const CEO = userOf("ceo", "ceo_cto");
const VP = userOf("vp", "vp_engineering_quality");
const ALICE = userOf("alice", "employee");

/** The HTTP status a policy call throws, or null when it allows the action. */
function statusOf(check: () => void): number | null {
  try {
    check();
    return null;
  } catch (error) {
    if (error instanceof AppError) return error.statusCode;
    throw error;
  }
}

describe("quality policy: self-QA conflict", () => {
  const vpTask = { assigneeId: "vp" };
  const aliceTask = { assigneeId: "alice" };

  it("forbids VP from managing quality items on their own task, but not on others'", () => {
    expect(statusOf(() => { assertCanManageFor(VP, vpTask); })).toBe(403);
    expect(statusOf(() => { assertCanManageFor(VP, aliceTask); })).toBeNull();
  });

  it("always lets the CEO manage, and never lets an assignee-only role manage", () => {
    expect(statusOf(() => { assertCanManageFor(CEO, vpTask); })).toBeNull();
    expect(statusOf(() => { assertCanManageFor(CEO, aliceTask); })).toBeNull();
    expect(statusOf(() => { assertCanManageFor(ALICE, aliceTask); })).toBe(403);
  });

  it("forbids VP from setting readiness for a project containing their own task", () => {
    expect(statusOf(() => { assertCanSetReadiness(VP, true); })).toBe(403);
    expect(statusOf(() => { assertCanSetReadiness(VP, false); })).toBeNull();
    expect(statusOf(() => { assertCanSetReadiness(CEO, false); })).toBeNull();
    expect(statusOf(() => { assertCanSetReadiness(ALICE, false); })).toBe(403);
  });

  it("gives VP only assignee moves on their own task's defects", () => {
    expect(statusOf(() => { assertCanMove(VP, { ...vpTask, status: "open" }, "in_progress"); })).toBeNull();
    expect(statusOf(() => { assertCanMove(VP, { ...vpTask, status: "in_progress" }, "fixed"); })).toBeNull();
    for (const [from, to] of [["open", "wont_fix"], ["fixed", "verified"], ["fixed", "open"]] as const) {
      expect(statusOf(() => { assertCanMove(VP, { ...vpTask, status: from }, to); })).toBe(403);
      expect(statusOf(() => { assertCanMove(CEO, { ...vpTask, status: from }, to); })).toBeNull();
    }
  });

  it("lets VP add notes and evidence to their own task's defects", () => {
    expect(statusOf(() => { assertCanRespond(VP, vpTask); })).toBeNull();
  });
});
