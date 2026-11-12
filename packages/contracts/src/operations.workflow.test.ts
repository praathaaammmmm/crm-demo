import { describe, expect, it } from "vitest";
import {
  automationHealth,
  automationNoteRequired,
  automationTransition,
  canMoveIncident,
  incidentStatusRequestSchema,
  INCIDENT_STATUSES,
  isSafeSummary,
  recordRunRequestSchema,
  releaseNoteRequired,
  releaseTransition,
} from "./operations.js";

describe("operations workflow", () => {
  it("incidents progress to resolved, which is final; resolving needs a resolution", () => {
    expect(canMoveIncident("open", "investigating")).toBe(true);
    expect(canMoveIncident("mitigated", "investigating")).toBe(true);
    expect(canMoveIncident("open", "resolved")).toBe(true);
    expect(canMoveIncident("investigating", "open")).toBe(false);
    for (const to of INCIDENT_STATUSES) expect(canMoveIncident("resolved", to)).toBe(false);
    expect(incidentStatusRequestSchema.safeParse({ to: "resolved" }).success).toBe(false);
    expect(incidentStatusRequestSchema.safeParse({ to: "resolved", resolution: "Restarted the pool" }).success).toBe(true);
    expect(incidentStatusRequestSchema.safeParse({ to: "mitigated", resolution: "x" }).success).toBe(false);
  });

  it("production releases need CEO approval before a deployment outcome; staging does not", () => {
    expect(releaseTransition("production", "draft", "awaiting_approval")).toBe("manager");
    expect(releaseTransition("production", "awaiting_approval", "approved")).toBe("approver");
    expect(releaseTransition("production", "awaiting_approval", "rejected")).toBe("approver");
    expect(releaseTransition("production", "rejected", "draft")).toBe("manager");
    expect(releaseTransition("production", "approved", "deployed")).toBe("manager");
    expect(releaseTransition("production", "draft", "deployed")).toBeNull();
    expect(releaseTransition("production", "awaiting_approval", "deployed")).toBeNull();
    expect(releaseTransition("staging", "draft", "deployed")).toBe("manager");
    expect(releaseTransition("staging", "draft", "awaiting_approval")).toBeNull();
    expect(releaseTransition("staging", "deployed", "rolled_back")).toBe("manager");
    expect(releaseTransition("production", "failed", "rolled_back")).toBe("manager");
    expect(releaseTransition("production", "rolled_back", "deployed")).toBeNull();
    expect(releaseNoteRequired("rejected")).toBe(true);
    expect(releaseNoteRequired("rolled_back")).toBe(true);
    expect(releaseNoteRequired("approved")).toBe(false);
  });

  it("automations go live only through CEO approval; retired is final", () => {
    expect(automationTransition("draft", "testing")).toBe("manager");
    expect(automationTransition("testing", "awaiting_approval")).toBe("manager");
    expect(automationTransition("awaiting_approval", "live")).toBe("approver");
    expect(automationTransition("awaiting_approval", "testing")).toBe("approver");
    expect(automationTransition("testing", "live")).toBeNull();
    expect(automationTransition("live", "paused")).toBe("manager");
    expect(automationTransition("paused", "live")).toBe("manager");
    expect(automationTransition("live", "retired")).toBe("manager");
    expect(automationTransition("retired", "draft")).toBeNull();
    expect(automationNoteRequired("awaiting_approval", "testing")).toBe(true);
  });

  it("health comes from the latest five runs", () => {
    expect(automationHealth([])).toBe("unknown");
    expect(automationHealth(["failed", "succeeded"])).toBe("failing");
    expect(automationHealth(["succeeded", "failed"])).toBe("degraded");
    expect(automationHealth(["succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "failed"])).toBe("healthy");
  });

  it("run summaries must be safe; failed runs need one and successful runs take none", () => {
    expect(isSafeSummary("Timed out reading the queue")).toBe(true);
    for (const unsafe of ["see https://logs.example.com", "password=hunter2", "Bearer abc", "api_key leaked", "at fn (file.js:1)", "a\nb"]) {
      expect(isSafeSummary(unsafe)).toBe(false);
    }
    const base = { startedAt: "2026-11-12T10:00:00Z", finishedAt: "2026-11-12T10:01:00Z" };
    expect(recordRunRequestSchema.safeParse({ ...base, outcome: "failed" }).success).toBe(false);
    expect(recordRunRequestSchema.safeParse({ ...base, outcome: "failed", errorSummary: "Queue timeout" }).success).toBe(true);
    expect(recordRunRequestSchema.safeParse({ ...base, outcome: "succeeded", errorSummary: "x" }).success).toBe(false);
    expect(recordRunRequestSchema.safeParse({ ...base, finishedAt: "2026-11-12T09:00:00Z", outcome: "succeeded" }).success).toBe(false);
  });
});
