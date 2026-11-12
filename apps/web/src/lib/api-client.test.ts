import { sessionResponseSchema } from "@crm/contracts/identity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, failureMessage, interpretResponse, noContent, redirectForSession } from "./api-client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const session = {
  user: { id: "0196f3a0-0000-7000-8000-000000000001", email: "a@example.test", name: "A", role: "employee", isSuperAdmin: false },
  mustChangePassword: false,
  sessionExpiresAt: "2026-11-11T12:00:00.000Z",
};

describe("interpretResponse", () => {
  it("returns data for a body that matches the strict contract", async () => {
    const result = await interpretResponse(json(200, session), sessionResponseSchema);
    expect(result).toEqual({ ok: true, data: session });
  });

  it("rejects a success body with fields outside the contract", async () => {
    const result = await interpretResponse(json(200, { ...session, passwordHash: "x" }), sessionResponseSchema);
    expect(result).toEqual({ ok: false, failure: { kind: "unexpected" } });
  });

  it("accepts 204 only for no-content calls", async () => {
    expect(await interpretResponse(new Response(null, { status: 204 }), noContent)).toEqual({ ok: true, data: undefined });
    expect((await interpretResponse(new Response(null, { status: 204 }), sessionResponseSchema)).ok).toBe(false);
  });

  it.each([
    [400, { code: "VALIDATION_FAILED", message: "Bad input" }, { kind: "invalid", message: "Bad input" }],
    [401, { code: "UNAUTHENTICATED", message: "x" }, { kind: "unauthenticated" }],
    [403, { code: "PASSWORD_CHANGE_REQUIRED", message: "x" }, { kind: "password_change_required" }],
    [403, { code: "FORBIDDEN", message: "Forbidden" }, { kind: "forbidden", message: "Forbidden" }],
    [403, { code: "DEMO_READ_ONLY", message: "anything" }, { kind: "demo_read_only" }],
    [404, { code: "NOT_FOUND", message: "Not found" }, { kind: "not_found" }],
    [409, { code: "CONFLICT", message: "Already decided" }, { kind: "conflict", message: "Already decided" }],
    [429, { code: "RATE_LIMITED", message: "x" }, { kind: "rate_limited" }],
    [500, { code: "INTERNAL", message: "x" }, { kind: "unexpected" }],
  ])("maps HTTP %i to its failure", async (status, body, failure) => {
    expect(await interpretResponse(json(status, body), noContent)).toEqual({ ok: false, failure });
  });

  it("treats a non-JSON error body as unexpected for unknown statuses", async () => {
    const result = await interpretResponse(new Response("<html>", { status: 502 }), noContent);
    expect(result).toEqual({ ok: false, failure: { kind: "unexpected" } });
  });
});

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the same-origin /api/v1 path with a JSON body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, session)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiRequest("/auth/login", sessionResponseSchema, { method: "POST", body: { email: "a" } });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a" }),
    });
  });

  it("sends PATCH with a JSON body and the same options as POST", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, session)));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/tasks/x", sessionResponseSchema, { method: "PATCH", body: { priority: "low" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/tasks/x", {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: "low" }),
    });
  });

  it("reports a network error as unexpected", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    expect(await apiRequest("/auth/me", sessionResponseSchema)).toEqual({ ok: false, failure: { kind: "unexpected" } });
  });
});

describe("redirectForSession", () => {
  it("sends unauthenticated users to /login and pending password changes to /change-password", () => {
    const replace = vi.fn();
    expect(redirectForSession({ replace }, { kind: "unauthenticated" })).toBe(true);
    expect(redirectForSession({ replace }, { kind: "password_change_required" })).toBe(true);
    expect(redirectForSession({ replace }, { kind: "forbidden", message: "x" })).toBe(false);
    expect(replace.mock.calls).toEqual([["/login"], ["/change-password"]]);
  });
});

describe("failureMessage", () => {
  it("shows the fixed public demo message for a refused write", () => {
    expect(failureMessage({ kind: "demo_read_only" })).toBe("This public demo is read-only.");
  });
});
