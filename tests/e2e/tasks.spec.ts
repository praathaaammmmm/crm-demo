import { expect, test, type Page } from "@playwright/test";
import { authFile, USERS } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const PROJECT = "E2E Launch Project";
const TASK = "Write the launch checklist";
const NOT_ALLOWED = "You do not have access to this page";

let taskUrl = "";

const rail = (page: Page) => page.getByRole("complementary", { name: "Task details" });

async function openTask(page: Page): Promise<void> {
  expect(taskUrl).not.toBe("");
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: TASK })).toBeVisible();
}

test.describe("CEO creates work", () => {
  test.use({ storageState: authFile("ceo") });

  test("creates a project and a task from the dialogs", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill(PROJECT);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();

    // The board is the default project view, and "New task" is offered only in the Todo column.
    await expect(page.getByRole("button", { name: "New task in Todo" })).toHaveCount(1);
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Title").fill(TASK);
    await page.getByLabel("Due date").fill("2099-01-31");
    await page.getByLabel("Assignee").selectOption({ label: USERS.employee.name });
    await page.getByRole("button", { name: "Create task" }).click();

    const card = page.getByRole("link", { name: TASK });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("heading", { name: TASK })).toBeVisible();
    taskUrl = new URL(page.url()).pathname;
  });

  test("task pages offer no search, sort or drag controls", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sort/i })).toHaveCount(0);
    await expect(page.locator("[draggable=true]")).toHaveCount(0);
  });
});

test.describe("employee works the task", () => {
  test.use({ storageState: authFile("employee") });

  test("starts, posts an update, adds https proof and submits", async ({ page }) => {
    await openTask(page);
    await rail(page).getByRole("button", { name: "Start" }).click();
    await expect(rail(page).getByText("In progress")).toBeVisible();

    await page.getByLabel("Progress update").fill("Drafted the first half");
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByText("Drafted the first half")).toBeVisible();

    await rail(page).getByRole("button", { name: "Add proof" }).click();
    const dialog = page.getByRole("dialog", { name: "Add proof of work" });
    await dialog.getByLabel("Link").fill("http://example.test/checklist");
    await dialog.getByRole("button", { name: "Save proof" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Use a link that starts with https://");

    await dialog.getByLabel("Link").fill("https://example.test/checklist");
    await dialog.getByRole("button", { name: "Save proof" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("https://example.test/checklist")).toBeVisible();

    await rail(page).getByRole("button", { name: "Submit for review" }).click();
    await expect(rail(page).getByText("In review")).toBeVisible();
  });

  test("cannot open the review queue", async ({ page }) => {
    await page.goto("/review");
    await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
  });
});

test.describe("CEO requests changes", () => {
  test.use({ storageState: authFile("ceo") });

  test("must give a note to send the task back", async ({ page }) => {
    await page.goto("/review");
    const row = page.getByRole("row").filter({ hasText: TASK });
    await row.getByRole("button", { name: "Request changes" }).click();
    const dialog = page.getByRole("dialog", { name: "Request changes" });
    await dialog.getByRole("button", { name: "Send back" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("A note is required to request changes.");

    await dialog.getByLabel("What needs to change?").fill("Add the rollback steps");
    await dialog.getByRole("button", { name: "Send back" }).click();
    await expect(page.getByRole("row").filter({ hasText: TASK })).toHaveCount(0);
  });
});

test.describe("employee resubmits", () => {
  test.use({ storageState: authFile("employee") });

  test("sees the review note and submits again", async ({ page }) => {
    await openTask(page);
    await expect(page.getByText("Add the rollback steps")).toBeVisible();
    await rail(page).getByRole("button", { name: "Submit for review" }).click();
    await expect(rail(page).getByText("In review")).toBeVisible();
  });
});

test.describe("CEO approves", () => {
  test.use({ storageState: authFile("ceo") });

  test("approves from the queue and the task becomes read-only", async ({ page }) => {
    await page.goto("/review");
    const row = page.getByRole("row").filter({ hasText: TASK });
    await row.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog", { name: "Approve work" }).getByRole("button", { name: "Confirm approval" }).click();
    await expect(page.getByText("Nothing waiting for review")).toBeVisible();

    await openTask(page);
    await expect(page.getByText("This task is completed and read-only.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit task" })).toHaveCount(0);
  });

  test("dashboard tiles reflect the completed task", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Completed/ })).toContainText("1");
    await expect(page.getByRole("link", { name: /Pending review/ })).toContainText("0");
  });
});

test.describe("employee after completion", () => {
  test.use({ storageState: authFile("employee") });

  test("has no actions on the completed task", async ({ page }) => {
    await openTask(page);
    await expect(page.getByText("This task is completed and read-only.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    await expect(page.getByLabel("Progress update")).toHaveCount(0);
  });
});

test.describe("CFO", () => {
  test.use({ storageState: authFile("cfo") });

  test("cannot see a task outside their work", async ({ page }) => {
    await page.goto(taskUrl);
    await expect(page.getByRole("heading", { name: TASK })).toHaveCount(0);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
