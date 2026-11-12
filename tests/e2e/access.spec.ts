import { expect, test } from "@playwright/test";
import { authFile } from "./fixtures.js";

const NOT_ALLOWED = "You do not have access to this page";

test.describe("employee", () => {
  test.use({ storageState: authFile("employee") });

  test("sees Home, My tasks, Projects and Defects and is refused Users, Approvals, Review and Quality by URL", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
      "Home",
      "My tasks",
      "Meetings",
      "Projects",
      "Defects",
    ]);

    for (const hidden of ["/users", "/approvals", "/review", "/quality"]) {
      await page.goto(hidden);
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
    }
  });
});

test.describe("CFO", () => {
  test.use({ storageState: authFile("cfo") });

  test("sees the directory without emails", async ({ page }) => {
    await page.goto("/users");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
      "Home",
      "My tasks",
      "Meetings",
      "Projects",
      "Defects",
      "Users",
      "Approvals",
    ]);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Email" })).toHaveCount(0);
  });
});

test.describe("CEO", () => {
  test.use({ storageState: authFile("ceo") });

  test("sees dashboard counts and the directory with emails", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Pending approvals")).toBeVisible();
    await expect(page.getByText("Active users")).toBeVisible();

    await page.goto("/users");
    await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();
  });
});
