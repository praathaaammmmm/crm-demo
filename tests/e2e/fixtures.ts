import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** Ports used only by the e2e run, so they never clash with local development servers. */
export const API_PORT = 4100;
export const WEB_PORT = 3100;
export const API_ORIGIN = `http://localhost:${String(API_PORT)}`;
export const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
/** Saved logins for the throwaway database. Deleted by global teardown. */
export const AUTH_DIR = path.join(import.meta.dirname, ".auth");

export type SavedRole = "ceo" | "cfo" | "cgo" | "cmo" | "employee" | "vp";
export const authFile = (role: SavedRole): string => path.join(AUTH_DIR, `${role}.json`);

const user = (key: string, name: string) => ({
  email: `${key}@example.test`,
  name,
  password: `e2e-${key}-password`,
});

/** Test-only accounts, created only in the throwaway database. These are not real credentials. */
export const USERS = {
  ceo: { email: "ceo@example.test", name: "Test CEO", password: "test-super-admin-password" },
  cfo: user("cfo", "Test CFO"),
  cgo: user("cgo", "Test CGO"),
  cmo: user("cmo", "Test CMO"),
  vp: user("vp", "Test VP"),
  employee: user("employee", "Test Employee"),
  authUser: user("auth-user", "Auth User"),
  newUser: user("new-user", "New User"),
  targetApprove: user("target-approve", "Target Approve"),
  targetReject: user("target-reject", "Target Reject"),
  targetCancel: user("target-cancel", "Target Cancel"),
} as const;

/** Signs in through the login page. Only used where the spec is about the login flow itself. */
/**
 * Seeded in the throwaway database for quality.spec.ts: a project with a task assigned to USERS.employee,
 * and a second project with a task assigned to USERS.vp (self-QA conflict).
 */
export const QUALITY_SEED = {
  project: "E2E Quality Project",
  task: "Ship the CSV export",
  vpProject: "E2E VP Own Project",
  vpTask: "Review the release notes",
} as const;

export async function signInThroughUi(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
