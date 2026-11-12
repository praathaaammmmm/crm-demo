import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const NOT_ALLOWED = "You do not have access to this page";
const INCIDENT = "E2E Checkout outage";
const RELEASE = "E2E Payments release";
const AUTOMATION = "E2E Nightly export";

let incidentUrl = "";
let releaseUrl = "";
let automationUrl = "";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

/** "YYYY-MM-DDTHH:MM" in local time, `minutes` from now, for datetime-local inputs. */
function localTime(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function act(page: Page, button: string, fill: Record<string, string> = {}) {
  await page.getByRole("button", { name: button, exact: true }).click();
  const form = dialog(page, `${button}?`);
  for (const [label, value] of Object.entries(fill)) await form.getByLabel(label).fill(value);
  await form.getByRole("button", { name: button, exact: true }).click();
  await expect(form).toBeHidden();
}

test.describe("VP Engineering & Quality runs operations", () => {
  test.use({ storageState: authFile("vp") });

  test("sees the Engineering section and the operations summary at home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Engineering operations" })).toBeVisible();
    for (const label of ["Ops overview", "Incidents", "Releases", "Automations"]) await expect(nav(page).getByRole("link", { name: label })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Campaigns" })).toHaveCount(0);
  });

  test("opens an incident, works it through to resolution and writes the post-incident note", async ({ page }) => {
    await page.goto("/operations/incidents");
    await page.getByRole("button", { name: "New incident" }).click();
    const form = dialog(page, "New incident");
    await form.getByLabel("Title").fill(INCIDENT);
    await form.getByLabel("Severity").selectOption({ label: "SEV 1" });
    await form.getByRole("button", { name: "Open incident" }).click();
    await expect(page.getByRole("heading", { level: 1, name: INCIDENT })).toBeVisible();
    incidentUrl = new URL(page.url()).pathname;

    await page.getByRole("button", { name: "Mark investigating" }).click();
    await dialog(page, "Mark investigating").getByLabel("Note").fill("Paged the on-call engineer");
    await dialog(page, "Mark investigating").getByRole("button", { name: "Confirm" }).click();
    await expect(dialog(page, "Mark investigating")).toBeHidden();
    await page.getByRole("button", { name: "Add note" }).click();
    await dialog(page, "Add a timeline note").getByLabel("Note").fill("Database pool exhausted");
    await dialog(page, "Add a timeline note").getByRole("button", { name: "Add note" }).click();
    await expect(dialog(page, "Add a timeline note")).toBeHidden();
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    const resolve = dialog(page, "Resolve incident");
    await resolve.getByRole("button", { name: "Resolve" }).click();
    await expect(resolve.getByRole("alert")).toContainText("resolution");
    await resolve.getByLabel("Resolution").fill("Raised the pool size and restarted workers");
    await resolve.getByRole("button", { name: "Resolve" }).click();
    await expect(resolve).toBeHidden();

    await page.getByRole("button", { name: "Add post-incident note" }).click();
    await dialog(page, "Post-incident note").getByLabel("What we learned and will change").fill("Alert on pool saturation");
    await dialog(page, "Post-incident note").getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Alert on pool saturation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add post-incident note" })).toHaveCount(0);
    const timeline = page.getByRole("list", { name: "Incident timeline" }).getByRole("listitem");
    await expect(timeline).toHaveCount(3);
    await expect(timeline.nth(0)).toContainText("Open → Investigating");
    await expect(timeline.nth(2)).toContainText("Investigating → Resolved");
  });

  test("prepares a production release and submits it once the checklist is complete", async ({ page }) => {
    await page.goto("/operations/releases");
    await page.getByRole("button", { name: "New release" }).click();
    const form = dialog(page, "New release record");
    await form.getByLabel("Name").fill(RELEASE);
    await form.getByLabel("Version").fill("v2.4.0");
    await form.getByLabel("Environment").selectOption({ label: "Production" });
    await form.getByRole("button", { name: "Create release" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `${RELEASE} (v2.4.0)` })).toBeVisible();
    releaseUrl = new URL(page.url()).pathname;

    await page.getByRole("button", { name: "Add checklist item" }).click();
    await dialog(page, "Add checklist item").getByLabel("Item").fill("Migrations reviewed");
    await dialog(page, "Add checklist item").getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog(page, "Add checklist item")).toBeHidden();
    await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
    const early = dialog(page, "Submit for approval?");
    await early.getByRole("button", { name: "Submit for approval" }).click();
    await expect(early.getByRole("alert")).toHaveText("Complete the release checklist first");
    await early.getByRole("button", { name: "Cancel" }).click();
    await expect(early).toBeHidden();
    await page.getByRole("button", { name: "Tick Migrations reviewed" }).click();
    await dialog(page, "Mark as done?").getByRole("button", { name: "Confirm" }).click();
    await expect(dialog(page, "Mark as done?")).toBeHidden();
    await expect(page.getByText("✓ Migrations reviewed")).toBeVisible();
    await act(page, "Submit for approval");
    await expect(page.getByText("Awaiting approval", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("registers an automation, records a failed test run and requests go-live", async ({ page }) => {
    await page.goto("/operations/automations");
    await page.getByRole("button", { name: "Register automation" }).click();
    const form = dialog(page, "Register an automation");
    await form.getByLabel("Name").fill(AUTOMATION);
    await form.getByLabel("Purpose").fill("Export the daily report");
    await form.getByLabel("Trigger or schedule").fill("Every night at 02:00");
    await form.getByRole("button", { name: "Register" }).click();
    await expect(page.getByRole("heading", { level: 1, name: AUTOMATION })).toBeVisible();
    automationUrl = new URL(page.url()).pathname;

    await act(page, "Start testing");
    await page.getByRole("button", { name: "Record run" }).click();
    const run = dialog(page, "Record a run");
    await run.getByLabel("Started at").fill(localTime(-10));
    await run.getByLabel("Finished at").fill(localTime(-9));
    await run.getByLabel("Outcome").selectOption({ label: "Failed" });
    await run.getByLabel("Error summary").fill("token=abc leaked");
    await run.getByRole("button", { name: "Record run" }).click();
    // The API refuses secret-like text without echoing it back.
    await expect(run.getByRole("alert")).toBeVisible();
    await run.getByLabel("Error summary").fill("Export timed out");
    await run.getByRole("button", { name: "Record run" }).click();
    await expect(run).toBeHidden();
    await expect(page.getByText("Failing", { exact: true })).toBeVisible();
    await act(page, "Request go-live");
    await expect(page.getByRole("button", { name: "Approve go-live" })).toHaveCount(0);
  });
});

test.describe("CEO/CTO approves and reads operations", () => {
  test.use({ storageState: authFile("ceo") });

  test("sees operations on the dashboard and approves the production release", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Engineering operations" })).toBeVisible();
    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "Releases waiting for your approval" })).toBeVisible();
    await page.getByRole("link", { name: `${RELEASE} (v2.4.0)` }).click();
    await expect(page.getByRole("button", { name: "Add checklist item" })).toHaveCount(0);
    await act(page, "Approve");
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record deployed" })).toHaveCount(0);
  });

  test("approves the automation go-live and cannot open incidents", async ({ page }) => {
    await page.goto(automationUrl);
    await act(page, "Approve go-live");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await page.goto("/operations/incidents");
    await expect(page.getByRole("button", { name: "New incident" })).toHaveCount(0);
    await page.goto(incidentUrl);
    await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
  });
});

test.describe("VP records the deployment outcome and a rollback", () => {
  test.use({ storageState: authFile("vp") });

  test("records deployed, then a rollback that needs a note", async ({ page }) => {
    await page.goto(releaseUrl);
    await act(page, "Record deployed");
    await page.getByRole("button", { name: "Record rollback", exact: true }).click();
    const rollback = dialog(page, "Record rollback?");
    await rollback.getByRole("button", { name: "Record rollback" }).click();
    await expect(rollback.getByRole("alert")).toBeVisible();
    await rollback.getByLabel("Rollback record").fill("Error rate doubled after deploy");
    await rollback.getByRole("button", { name: "Record rollback" }).click();
    await expect(rollback).toBeHidden();
    const decisions = page.getByRole("list", { name: "Release decisions" }).getByRole("listitem");
    await expect(decisions).toHaveCount(4);
    await expect(decisions.nth(1)).toContainText("Awaiting approval → Approved");
    await expect(decisions.nth(3)).toContainText("Error rate doubled after deploy");
  });
});

for (const role of ["cmo", "employee", "cgo"] as const) {
  test.describe(`${role} without Operations access`, () => {
    test.use({ storageState: authFile(role) });

    test("sees no Engineering navigation and is refused Operations pages", async ({ page }) => {
      await page.goto("/");
      await expect(nav(page).getByRole("link", { name: "Incidents" })).toHaveCount(0);
      for (const path of ["/operations", "/operations/incidents", "/operations/releases", "/operations/automations"]) {
        await page.goto(path);
        await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
      }
    });
  });
}
