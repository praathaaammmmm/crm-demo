import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const NOT_ALLOWED = "You do not have access to this page";
const CAMPAIGN = "E2E Launch Campaign";
const POST = "E2E Launch Post";

let campaignUrl = "";
let contentUrl = "";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

/** Today as YYYY-MM-DD in the browser's (and the org test) calendar. */
const today = () => new Date().toLocaleDateString("en-CA");

async function confirmAction(page: Page, button: string, title: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await dialog(page, title).getByRole("button", { name: "Confirm" }).click();
  await expect(dialog(page, title)).toBeHidden();
}

test.describe("CMO runs a campaign", () => {
  test.use({ storageState: authFile("cmo") });

  test("sees the Marketing section and a Marketing summary at home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Marketing", exact: true })).toBeVisible();
    for (const label of ["Marketing overview", "Campaigns", "Content calendar"]) await expect(nav(page).getByRole("link", { name: label })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Incidents" })).toHaveCount(0);
  });

  test("creates a campaign and moves it to active", async ({ page }) => {
    await page.goto("/marketing/campaigns");
    await page.getByRole("button", { name: "New campaign" }).click();
    const form = dialog(page, "New campaign");
    await form.getByLabel("Name").fill(CAMPAIGN);
    await form.getByLabel("Objective").fill("Announce the release");
    await form.getByRole("button", { name: "Create campaign" }).click();
    await expect(page.getByRole("heading", { level: 1, name: CAMPAIGN })).toBeVisible();
    campaignUrl = new URL(page.url()).pathname;
    await confirmAction(page, "Mark planned", "Mark the campaign planned?");
    await confirmAction(page, "Mark active", "Mark the campaign active?");
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
  });

  test("plans LinkedIn content in the campaign, reviews and publishes it with a proof link", async ({ page }) => {
    await page.goto(campaignUrl);
    await page.getByRole("button", { name: "Add content" }).click();
    const form = dialog(page, "Add content to this campaign");
    await form.getByLabel("Title").fill(POST);
    await form.getByLabel("Channel").selectOption({ label: "LinkedIn" });
    await form.getByLabel("Planned for").fill(today());
    await form.getByRole("button", { name: "Add content" }).click();
    await expect(page.getByRole("heading", { level: 1, name: POST })).toBeVisible();
    contentUrl = new URL(page.url()).pathname;

    await confirmAction(page, "Move to planned", "Move to planned?");
    await confirmAction(page, "Move to in review", "Move to in review?");
    await page.getByRole("button", { name: "Mark published" }).click();
    const publish = dialog(page, "Mark as published");
    await publish.getByLabel("Link to the live post").fill("http://www.linkedin.com/posts/e2e");
    await publish.getByRole("button", { name: "Mark published" }).click();
    await expect(publish.getByRole("alert")).toContainText("https://");
    await publish.getByLabel("Link to the live post").fill("https://www.linkedin.com/posts/e2e");
    await publish.getByRole("button", { name: "Mark published" }).click();
    await expect(publish).toBeHidden();
    await expect(page.getByRole("link", { name: "Live post" })).toHaveAttribute("href", "https://www.linkedin.com/posts/e2e");
    await expect(page.getByRole("button", { name: "Edit content" })).toHaveCount(0);
  });

  test("records outcomes and an asset link; the campaign reports them", async ({ page }) => {
    await page.goto(contentUrl);
    await page.getByRole("button", { name: "Record outcome" }).click();
    const outcome = dialog(page, "Record outcome");
    await outcome.getByLabel("Reach").fill("1500");
    await outcome.getByLabel("Clicks").fill("42");
    await outcome.getByRole("button", { name: "Save outcome" }).click();
    await expect(outcome).toBeHidden();
    await expect(page.getByText("Reach 1,500 · Engagements — · Clicks 42")).toBeVisible();

    await page.getByRole("button", { name: "Add asset link" }).click();
    const asset = dialog(page, "Add asset link");
    await asset.getByLabel("Label").fill("Hero image");
    await asset.getByLabel("Link").fill("https://cdn.example.com/hero.png");
    await asset.getByRole("button", { name: "Add link" }).click();
    await expect(asset).toBeHidden();
    await expect(page.getByRole("table", { name: "Asset links" }).getByRole("link", { name: "Hero image" })).toBeVisible();

    await page.goto(campaignUrl);
    await expect(page.getByText(/1 published on time, 0 late/)).toBeVisible();
    const linkedin = page.getByRole("table", { name: "Campaign outcome by channel" }).getByRole("row").filter({ hasText: "LinkedIn" });
    await expect(linkedin).toContainText("1,500");
  });

  test("the calendar groups content by date", async ({ page }) => {
    await page.goto("/marketing/content");
    await expect(page.getByRole("region", { name: today() }).getByRole("link", { name: POST })).toBeVisible();
    await page.getByRole("link", { name: "YouTube" }).click();
    await expect(page.getByRole("link", { name: POST })).toHaveCount(0);
  });
});

test.describe("CEO/CTO reads Marketing", () => {
  test.use({ storageState: authFile("ceo") });

  test("sees Marketing on the dashboard and every record read-only", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Marketing", exact: true })).toBeVisible();
    await page.goto(campaignUrl);
    await expect(page.getByRole("heading", { level: 1, name: CAMPAIGN })).toBeVisible();
    for (const button of ["Edit campaign", "Add content", "Mark completed"]) await expect(page.getByRole("button", { name: button })).toHaveCount(0);
    await page.goto(contentUrl);
    await expect(page.getByRole("button", { name: "Record outcome" })).toHaveCount(0);
    await page.goto("/marketing/campaigns");
    await expect(page.getByRole("button", { name: "New campaign" })).toHaveCount(0);
  });
});

for (const role of ["cfo", "employee", "vp"] as const) {
  test.describe(`${role} without Marketing access`, () => {
    test.use({ storageState: authFile(role) });

    test("sees no Marketing navigation and is refused Marketing pages", async ({ page }) => {
      await page.goto("/");
      await expect(nav(page).getByRole("link", { name: "Campaigns" })).toHaveCount(0);
      for (const path of ["/marketing", "/marketing/campaigns", "/marketing/content"]) {
        await page.goto(path);
        await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
      }
    });
  });
}
