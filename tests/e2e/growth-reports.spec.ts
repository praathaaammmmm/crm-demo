import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./fixtures.js";

const NOT_ALLOWED = "You do not have access to this page";
/** A closed historical range: always before the throwaway database existed, so it holds no closed or entered leads. */
const EMPTY_RANGE = "/growth?from=2020-01-01&to=2020-01-31";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("CGO Growth overview", () => {
  test.use({ storageState: authFile("cgo") });

  test("opens from navigation and shows tiles, breakdowns and the lead lists", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Growth (last 90 days)" })).toBeVisible();
    await nav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Growth overview" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    for (const tile of ["Open pipeline", "Overdue follow-ups", "Stale (over 14 days)", "Won in range", "Lost in range", "Win rate"]) {
      await expect(page.getByRole("link", { name: new RegExp(tile.replace(/[()]/g, "\\$&")) })).toBeVisible();
    }
    for (const section of ["Open pipeline by stage", "Funnel in range", "Overdue follow-ups", "By owner", "By source", "By company"]) {
      await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
    }
    await expect(page.getByRole("table", { name: "Outcomes by source" }).getByRole("row")).toHaveCount(9);
    await expect(page.getByRole("button", { name: "New lead" })).toHaveCount(0);
  });

  test("presets and the date form change the range; an empty range shows empty states", async ({ page }) => {
    await page.goto("/growth");
    await expect(page.getByRole("link", { name: "Last 90 days" })).toHaveAttribute("aria-current", /.+/);
    await page.getByRole("link", { name: "Last 30 days" }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);

    const form = page.getByRole("form", { name: "Date range" });
    await form.getByLabel("From").fill("2020-01-01");
    await form.getByLabel("To").fill("2020-01-31");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(EMPTY_RANGE);
    await expect(page.getByText("Nothing in this range")).toBeVisible();
    await expect(page.getByText("Nothing lost in this range")).toBeVisible();
  });

  test("an invalid or future range shows an error with a way back", async ({ page }) => {
    await page.goto("/growth?from=2026-13-01");
    await expect(page.getByRole("alert").filter({ hasText: "Enter dates as YYYY-MM-DD" })).toHaveText("Enter dates as YYYY-MM-DD");
    await page.goto("/growth?from=2099-01-01&to=2099-01-02");
    await expect(page.getByRole("alert").filter({ hasText: "The end date cannot be in the future" })).toHaveText("The end date cannot be in the future");
    await page.getByRole("link", { name: "Show the last 90 days" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Growth overview" })).toBeVisible();
  });

  test("the stale tile opens the stale lead list", async ({ page }) => {
    await page.goto("/growth");
    await page.getByRole("link", { name: /Stale \(over 14 days\)/ }).click();
    await expect(page).toHaveURL(/\/growth\/leads\?view=list&stale=true/);
    await expect(page.getByRole("link", { name: "Stale" })).toBeVisible();
  });
});

test.describe("CEO/CTO Growth overview", () => {
  test.use({ storageState: authFile("ceo") });

  test("the dashboard has a Growth section and the overview is read-only", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Growth (last 90 days)" })).toBeVisible();
    await page.getByRole("region", { name: "Growth (last 90 days)" }).getByRole("link", { name: "View overview" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Growth overview" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Outcomes by source" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New lead" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move stage" })).toHaveCount(0);
  });
});

for (const role of ["employee", "cfo", "vp"] as const) {
  test.describe(`${role} without Growth access`, () => {
    test.use({ storageState: authFile(role) });

    test("sees no Overview navigation or home Growth section and is refused the page", async ({ page }) => {
      await page.goto("/");
      await expect(nav(page).getByRole("link", { name: "Overview", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Growth (last 90 days)" })).toHaveCount(0);
      await page.goto("/growth");
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
    });
  });
}
