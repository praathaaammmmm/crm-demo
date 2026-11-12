import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const COMPANY = "E2E Leads Co";
const LEAD = "E2E Pipeline Deal";
const NOT_ALLOWED = "You do not have access to this page";

let companyUrl = "";
let leadUrl = "";

const history = (page: Page) => page.getByRole("list", { name: "Stage history" }).getByRole("listitem");

async function move(page: Page, to: string) {
  await page.getByRole("button", { name: "Move stage" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to another stage" });
  await dialog.getByLabel("New stage").selectOption({ label: to });
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("CGO works a lead", () => {
  test.use({ storageState: authFile("cgo") });

  test("sets up a company with a reachable and a do-not-contact contact", async ({ page }) => {
    await page.goto("/growth/companies");
    await page.getByRole("button", { name: "New company" }).click();
    const drawer = page.getByRole("dialog", { name: "New company" });
    await drawer.getByLabel("Name").fill(COMPANY);
    await drawer.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByRole("heading", { name: COMPANY })).toBeVisible();
    companyUrl = new URL(page.url()).pathname;
    for (const [name, email] of [
      ["Ravi Menon", "ravi@example.test"],
      ["Nila Das", "nila@example.test"],
    ] as const) {
      await page.getByRole("button", { name: "Add contact" }).click();
      const contact = page.getByRole("dialog", { name: "Add contact" });
      await contact.getByLabel("Full name").fill(name);
      await contact.getByLabel("Email").fill(email);
      await contact.getByRole("button", { name: "Add contact" }).click();
      await expect(contact).toBeHidden();
    }
    await page.getByRole("row").filter({ hasText: "Nila Das" }).getByRole("button", { name: "Mark do not contact: Nila Das" }).click();
    await page.getByRole("dialog", { name: "Mark as do not contact?" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("row").filter({ hasText: "Nila Das" }).getByText("Do not contact", { exact: true })).toBeVisible();
  });

  test("creates a lead linked to the company; it starts in New on the board", async ({ page }) => {
    await page.goto("/growth/leads");
    await page.getByRole("button", { name: "New lead" }).click();
    const drawer = page.getByRole("dialog", { name: "New lead" });
    await drawer.getByLabel("Name").fill(LEAD);
    await drawer.getByLabel("Company").selectOption({ label: COMPANY });
    await drawer.getByLabel("Estimated value (₹)").fill("250000");
    await drawer.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByRole("heading", { name: LEAD })).toBeVisible();
    leadUrl = new URL(page.url()).pathname;
    await expect(page.getByText("₹2,50,000")).toBeVisible();
    await page.goto("/growth/leads");
    await expect(page.getByRole("region", { name: /^New/ }).getByRole("link", { name: LEAD })).toBeVisible();
  });

  test("new → contacted → new → contacted → new records four history entries", async ({ page }) => {
    await page.goto(leadUrl);
    for (const to of ["Contacted", "New", "Contacted", "New"]) await move(page, to);
    await expect(history(page)).toHaveCount(4);
    await expect(history(page).nth(0)).toContainText("New → Contacted");
    await expect(history(page).nth(1)).toContainText("Contacted → New");
    await expect(history(page).nth(3)).toContainText("Contacted → New");
  });

  test("activity drawer: outbound needs a contact and is refused for do-not-contact", async ({ page }) => {
    await page.goto(leadUrl);
    await page.getByRole("button", { name: "Log activity" }).click();
    const drawer = page.getByRole("dialog", { name: "Log activity" });
    const outbound = drawer.getByRole("option", { name: "Outbound (we reached them)" });
    await expect(outbound).toBeDisabled();
    await drawer.getByLabel("Contact").selectOption({ label: "Nila Das (do not contact)" });
    await expect(outbound).toBeDisabled();
    await drawer.getByLabel("Contact").selectOption({ label: "Ravi Menon" });
    await expect(outbound).toBeEnabled();
    await drawer.getByLabel("Direction").selectOption("outbound");
    await drawer.getByLabel("Summary").fill("Sent an intro on LinkedIn");
    await drawer.getByLabel("Proof link").fill("http://not-safe.test");
    await drawer.getByRole("button", { name: "Log activity" }).click();
    await expect(drawer.getByRole("alert")).toHaveText("Use a proof link that starts with https://");
    await drawer.getByLabel("Proof link").fill("");
    await drawer.getByRole("button", { name: "Log activity" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("list", { name: "Activity" })).toContainText("Sent an intro on LinkedIn");
  });

  test("voids the activity once; it stays visible", async ({ page }) => {
    await page.goto(leadUrl);
    const item = page.getByRole("list", { name: "Activity" }).getByRole("listitem").first();
    await item.getByRole("button", { name: "Void" }).click();
    const dialog = page.getByRole("dialog", { name: "Void this activity?" });
    await dialog.getByLabel("Reason").fill("Logged on the wrong lead");
    await dialog.getByRole("button", { name: "Void activity" }).click();
    await expect(item.getByText("Voided", { exact: true })).toBeVisible();
    await expect(item).toContainText("Void reason: Logged on the wrong lead");
    await expect(item.getByRole("button", { name: "Void" })).toHaveCount(0);
  });

  test("marks the lead lost with a reason and note; it becomes read-only for the CGO", async ({ page }) => {
    await page.goto(leadUrl);
    await page.getByRole("button", { name: "Mark lost" }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this lead lost?" });
    await dialog.getByRole("button", { name: "Mark lost" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Add a note explaining why.");
    await dialog.getByLabel("Note").fill("Budget frozen this quarter");
    await dialog.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText("Lost. Only the CEO/CTO can reopen this lead.")).toBeVisible();
    for (const name of ["Move stage", "Mark lost", "Edit lead", "Log activity", "Reopen lead"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
  });

  test("the overdue filter is link-based and shows only overdue leads", async ({ page }) => {
    await page.goto("/growth/leads?view=list&overdue=true");
    await expect(page.getByRole("link", { name: LEAD })).toHaveCount(0);
    await expect(page.getByText("No leads match")).toBeVisible();
  });
});

test.describe("CEO reopens and reassigns", () => {
  test.use({ storageState: authFile("ceo") });

  test("reopens the lost lead to Qualified with a note; no CGO controls are shown", async ({ page }) => {
    await page.goto(leadUrl);
    for (const name of ["Move stage", "Mark lost", "Edit lead", "Log activity", "Archive lead"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Reopen lead" }).click();
    const dialog = page.getByRole("dialog", { name: "Reopen this lead?" });
    await dialog.getByLabel("Reopen to").selectOption({ label: "Qualified" });
    await dialog.getByLabel("Note").fill("Budget approved after all");
    await dialog.getByRole("button", { name: "Reopen" }).click();
    await expect(dialog).toBeHidden();
    await expect(history(page)).toHaveCount(6);
    await expect(history(page).nth(5)).toContainText("Lost → Qualified");
    await expect(page.getByRole("button", { name: "Reopen lead" })).toHaveCount(0);
  });

  test("reassign offers only other active CGOs", async ({ page }) => {
    await page.goto(leadUrl);
    await page.getByRole("button", { name: "Reassign" }).click();
    const dialog = page.getByRole("dialog", { name: "Reassign this lead" });
    await expect(dialog.getByLabel("New owner").getByRole("option")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Reassign" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("There is no other active CGO to assign.");
  });

  test("sees the lead and its activity on the company page", async ({ page }) => {
    await page.goto(companyUrl);
    await expect(page.getByRole("link", { name: LEAD })).toBeVisible();
    await expect(page.getByRole("list", { name: "Activity" })).toContainText("Sent an intro on LinkedIn");
    await expect(page.getByRole("button", { name: "Log activity" })).toHaveCount(0);
  });
});

for (const role of ["cfo", "employee"] as const) {
  test.describe(`${role} has no lead access`, () => {
    test.use({ storageState: authFile(role) });

    test("sees no Leads navigation and is refused lead pages", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Leads" })).toHaveCount(0);
      await page.goto("/growth/leads");
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
      await page.goto(leadUrl);
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
    });
  });
}
