import { afterEach, describe, expect, it, vi } from "vitest";
import { demoLogin, isDemoMode } from "./demo";

describe("web demo mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless DEMO_MODE is exactly true", () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemoMode()).toBe(false);
    expect(demoLogin()).toBeNull();
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });

  it("lists the demo accounts and shows the password only when one is configured", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_LOGIN_PASSWORD", "");
    expect(demoLogin()?.password).toBeNull();
    vi.stubEnv("DEMO_LOGIN_PASSWORD", "public-demo-password");
    const login = demoLogin();
    expect(login?.password).toBe("public-demo-password");
    expect(login?.accounts.every((account) => account.email.endsWith("@example.test"))).toBe(true);
  });
});
