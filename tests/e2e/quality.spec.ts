import { expect, test, type Page } from "@playwright/test";
import { authFile, QUALITY_SEED } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const CHECK = "Export opens in a spreadsheet";
const DEFECT = "Export drops the last row";
const NOT_ALLOWED = "You do not have access to this page";

let taskUrl = "";
let defectUrl = "";
let vpTaskUrl = "";
let vpDefectUrl = "";
const VP_DEFECT = "Release notes miss the CSV change";

const rail = (page: Page) => page.getByRole("complementary", { name: "Defect details" });
const readinessRow = (page: Page) => page.getByRole("row").filter({ hasText: QUALITY_SEED.project });

async function openTask(page: Page): Promise<void> {
  expect(taskUrl).not.toBe("");
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: QUALITY_SEED.task })).toBeVisible();
}

test.describe("VP Engineering & Quality: checks and defects", () => {
  test.use({ storageState: authFile("vp") });

  test("sees all tasks read-only, with no task create, edit or review controls", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New task" })).toHaveCount(0);

    await page.getByRole("link", { name: QUALITY_SEED.task }).click();
    await expect(page.getByRole("heading", { name: QUALITY_SEED.task })).toBeVisible();
    taskUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("button", { name: "Edit task" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  });

  test("adds a QA check and records a failed result, which needs a note", async ({ page }) => {
    await openTask(page);
    await page.getByRole("button", { name: "Add QA check" }).click();
    const add = page.getByRole("dialog", { name: "Add QA check" });
    await add.getByLabel("What is checked").fill(CHECK);
    await add.getByRole("button", { name: "Add check" }).click();
    await expect(add).toBeHidden();

    await page.getByRole("button", { name: `Record result for ${CHECK}` }).click();
    const record = page.getByRole("dialog", { name: "Record QA result" });
    await record.getByLabel("Outcome").selectOption("failed");
    await record.getByRole("button", { name: "Save result" }).click();
    await expect(record.getByRole("alert")).toHaveText("A note is required for failed or blocked results.");
    await record.getByLabel("Note").fill("Opens with a parse error");
    await record.getByRole("button", { name: "Save result" }).click();
    await expect(record).toBeHidden();
    await expect(page.getByRole("list", { name: "QA checks" }).getByText("Failed")).toBeVisible();
  });

  test("reports a defect from the task", async ({ page }) => {
    await openTask(page);
    await page.getByRole("button", { name: "Report defect" }).click();
    const drawer = page.getByRole("dialog", { name: "Report defect" });
    await drawer.getByLabel("Title").fill(DEFECT);
    await drawer.getByLabel("Severity").selectOption("high");
    await drawer.getByLabel("Reproduction steps").fill("Export 101 rows; the file has 100.");
    await drawer.getByLabel("Found by QA check").selectOption({ label: CHECK });
    await drawer.getByRole("button", { name: "Report defect" }).click();

    await expect(page.getByRole("heading", { name: DEFECT })).toBeVisible();
    defectUrl = new URL(page.url()).pathname;
    await expect(rail(page).getByText("Open", { exact: true })).toBeVisible();
  });

  test("cannot mark the release ready while blockers exist", async ({ page }) => {
    await page.goto("/quality");
    // No readiness decision yet: shown and counted as not ready.
    await expect(readinessRow(page).getByText("Not ready")).toBeVisible();
    await expect(readinessRow(page).getByText("No decision yet")).toBeVisible();
    // Both seeded projects have no decision yet.
    await expect(page.getByRole("link", { name: /Projects not ready/ })).toContainText("2");

    await readinessRow(page).getByRole("button", { name: `Set readiness for ${QUALITY_SEED.project}` }).click();
    const dialog = page.getByRole("dialog", { name: "Set release readiness" });
    await dialog.getByLabel("Release label").fill("v1");
    await dialog.getByLabel("Readiness").selectOption("ready");
    await dialog.getByRole("button", { name: "Save decision" }).click();
    await expect(dialog.getByRole("alert")).toContainText("cannot be marked ready");
  });

  test("defects page offers no search, sort or drag controls", async ({ page }) => {
    await page.goto("/defects");
    await expect(page.getByRole("link", { name: DEFECT })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sort/i })).toHaveCount(0);
    await expect(page.locator("[draggable=true]")).toHaveCount(0);
  });
});

test.describe("employee responds to the defect", () => {
  test.use({ storageState: authFile("employee") });

  test("finds it under Defects, starts it, adds https evidence and marks it fixed", async ({ page }) => {
    await page.goto("/defects");
    await page.getByRole("link", { name: DEFECT }).click();
    await expect(page.getByRole("heading", { name: DEFECT })).toBeVisible();

    await rail(page).getByRole("button", { name: "Start fix" }).click();
    await expect(rail(page).getByText("In progress", { exact: true })).toBeVisible();

    await rail(page).getByRole("button", { name: "Add evidence" }).click();
    const evidence = page.getByRole("dialog", { name: "Add evidence" });
    await evidence.getByLabel("Link").fill("http://example.test/fix");
    await evidence.getByRole("button", { name: "Save evidence" }).click();
    await expect(evidence.getByRole("alert")).toHaveText("Use a link that starts with https://");
    await evidence.getByLabel("Link").fill("https://example.test/fix");
    await evidence.getByRole("button", { name: "Save evidence" }).click();
    await expect(evidence).toBeHidden();
    await expect(page.getByText("https://example.test/fix")).toBeVisible();

    await rail(page).getByRole("button", { name: "Mark fixed" }).click();
    const fixed = page.getByRole("dialog", { name: "Mark fixed" });
    await fixed.getByRole("button", { name: "Confirm" }).click();
    await expect(fixed.getByRole("alert")).toHaveText("A note is required for this change.");
    await fixed.getByLabel("What was fixed?").fill("Off-by-one in the pager");
    await fixed.getByRole("button", { name: "Confirm" }).click();
    await expect(rail(page).getByText("Fixed", { exact: true })).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Verify fix" })).toHaveCount(0);
  });

  test("cannot open the quality overview", async ({ page }) => {
    await page.goto("/quality");
    await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
  });
});

test.describe("VP Engineering & Quality: verification and readiness", () => {
  test.use({ storageState: authFile("vp") });

  test("verifies the fix, records a passing result and marks the release ready", async ({ page }) => {
    expect(defectUrl).not.toBe("");
    await page.goto(defectUrl);
    await rail(page).getByRole("button", { name: "Verify fix" }).click();
    await expect(page.getByText("This defect is closed and read-only.")).toBeVisible();

    await openTask(page);
    await page.getByRole("button", { name: `Record result for ${CHECK}` }).click();
    const record = page.getByRole("dialog", { name: "Record QA result" });
    await record.getByLabel("Outcome").selectOption("passed");
    await record.getByRole("button", { name: "Save result" }).click();
    await expect(record).toBeHidden();

    await page.goto("/quality");
    await readinessRow(page).getByRole("button", { name: `Set readiness for ${QUALITY_SEED.project}` }).click();
    const dialog = page.getByRole("dialog", { name: "Set release readiness" });
    await dialog.getByLabel("Release label").fill("v1");
    await dialog.getByLabel("Readiness").selectOption("ready");
    await dialog.getByRole("button", { name: "Save decision" }).click();
    await expect(dialog).toBeHidden();
    await expect(readinessRow(page)).toHaveCount(0);
  });
});

test.describe("CEO: quality on the VP's own task", () => {
  test.use({ storageState: authFile("ceo") });

  test("can add checks and report defects on a task assigned to VP", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByRole("link", { name: QUALITY_SEED.vpTask }).click();
    await expect(page.getByRole("heading", { name: QUALITY_SEED.vpTask })).toBeVisible();
    vpTaskUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("button", { name: "Add QA check" })).toBeVisible();

    await page.getByRole("button", { name: "Report defect" }).click();
    const drawer = page.getByRole("dialog", { name: "Report defect" });
    await drawer.getByLabel("Title").fill(VP_DEFECT);
    await drawer.getByLabel("Severity").selectOption("low");
    await drawer.getByLabel("Reproduction steps").fill("Open the notes; the CSV export is not listed.");
    await drawer.getByRole("button", { name: "Report defect" }).click();
    await expect(page.getByRole("heading", { name: VP_DEFECT })).toBeVisible();
    vpDefectUrl = new URL(page.url()).pathname;
  });
});

test.describe("VP Engineering & Quality: self-QA conflict", () => {
  test.use({ storageState: authFile("vp") });

  test("acts only as the assignee on quality items of their own task", async ({ page }) => {
    expect(vpTaskUrl).not.toBe("");
    await page.goto(vpTaskUrl);
    await expect(page.getByRole("heading", { name: "Quality", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add QA check" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Report defect" })).toHaveCount(0);

    await page.goto(vpDefectUrl);
    await expect(rail(page).getByRole("button", { name: "Start fix" })).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Add evidence" })).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Edit defect" })).toHaveCount(0);
    await expect(rail(page).getByRole("button", { name: "Won't fix" })).toHaveCount(0);
    await expect(rail(page).getByText("someone else must edit, verify, reopen or close it")).toBeVisible();
  });

  test("cannot set readiness for a project containing their own task", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: QUALITY_SEED.vpProject }).click();
    await expect(page.getByRole("group", { name: "Release readiness" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Set readiness/ })).toHaveCount(0);

    // The API refuses it too, even from the Quality overview.
    await page.goto("/quality");
    await page.getByRole("button", { name: `Set readiness for ${QUALITY_SEED.vpProject}` }).click();
    const dialog = page.getByRole("dialog", { name: "Set release readiness" });
    await dialog.getByLabel("Release label").fill("v1");
    await dialog.getByLabel("Readiness").selectOption("at_risk");
    await dialog.getByLabel("Note").fill("Waiting on review");
    await dialog.getByRole("button", { name: "Save decision" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("You cannot manage quality for work assigned to you");
  });
});

test.describe("CEO", () => {
  test.use({ storageState: authFile("ceo") });

  test("sees exact quality counts on the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Quality", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Critical open/ })).toContainText("0");
    await expect(page.getByRole("link", { name: /High open/ })).toContainText("0");
    await expect(page.getByRole("link", { name: /Failed checks/ })).toContainText("0");
    // The VP's own project still has no decision.
    await expect(page.getByRole("link", { name: /Projects not ready/ })).toContainText("1");
  });
});

test.describe("CFO", () => {
  test.use({ storageState: authFile("cfo") });

  test("cannot see a defect outside their work", async ({ page }) => {
    expect(defectUrl).not.toBe("");
    await page.goto(defectUrl);
    await expect(page.getByRole("heading", { name: DEFECT })).toHaveCount(0);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
