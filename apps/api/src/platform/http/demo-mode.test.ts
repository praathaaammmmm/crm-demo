import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, loadServerEnv } from "../env.js";
import { isBlockedInDemo } from "./demo-mode.js";

const BASE_ENV = {
  APP_ORIGIN: "http://localhost:3000",
  API_PORT: "4000",
  DATABASE_URL_APP: "placeholder",
  ORG_TIMEZONE: "Asia/Kolkata",
};

describe("DEMO_MODE environment", () => {
  it("is off unless set to exactly true", () => {
    expect(loadServerEnv(BASE_ENV).DEMO_MODE).toBe(false);
    expect(loadServerEnv({ ...BASE_ENV, DEMO_MODE: "false" }).DEMO_MODE).toBe(false);
    expect(loadServerEnv({ ...BASE_ENV, DEMO_MODE: "true" }).DEMO_MODE).toBe(true);
  });

  it.each(["1", "yes", "TRUE", ""])("rejects %j and names only the variable", (value) => {
    expect(() => loadServerEnv({ ...BASE_ENV, DEMO_MODE: value })).toThrow(InvalidEnvironmentError);
    expect(() => loadServerEnv({ ...BASE_ENV, DEMO_MODE: value })).toThrow(/DEMO_MODE$/);
  });
});

describe("isBlockedInDemo", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("allows %s everywhere", (method) => {
    expect(isBlockedInDemo(method, "/api/v1/tasks")).toBe(false);
  });

  it("allows only sign-in and sign-out writes", () => {
    expect(isBlockedInDemo("POST", "/api/v1/auth/login")).toBe(false);
    expect(isBlockedInDemo("POST", "/api/v1/auth/logout")).toBe(false);
    expect(isBlockedInDemo("POST", "/api/v1/auth/login?next=/")).toBe(false);
  });

  it.each([
    ["POST", "/api/v1/auth/password"],
    ["PATCH", "/api/v1/auth/login"],
    ["POST", "/api/v1/auth/login/"],
    ["POST", "/api/v1/auth/LOGIN"],
    ["POST", "/api/v1/tasks?u=/api/v1/auth/login"],
    ["DELETE", "/api/v1/tasks/1"],
    ["PUT", "/anything"],
  ])("blocks %s %s", (method, url) => {
    expect(isBlockedInDemo(method, url)).toBe(true);
  });
});
