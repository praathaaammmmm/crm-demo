import { expect, test, type Page } from "@playwright/test";
import { authFile, WEB_ORIGIN } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const COMPANY = "E2E Growth Co";
const CONTACT = "Asha Rao";
const NOT_ALLOWED = "You do not have access to this page";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

let companyUrl = "";
let companyId = "";

const contactRow = (page: Page) => page.getByRole("row").filter({ hasText: CONTACT });

test.describe("CGO manages companies and contacts", () => {
  test.use({ storageState: authFile("cgo") });

  test("creates a company and a contact; a contact needs a way to reach them", async ({ page }) => {
    await page.goto("/growth/companies");
    await page.getByRole("button", { name: "New company" }).click();
    const drawer = page.getByRole("dialog", { name: "New company" });
    await drawer.getByLabel("Name").fill(`  ${COMPANY}  `);
    await drawer.getByLabel("Industry").fill("Software");
    await drawer.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByRole("heading", { name: COMPANY })).toBeVisible();
    companyUrl = new URL(page.url()).pathname;
    companyId = companyUrl.split("/").at(-1) ?? "";

    await page.getByRole("button", { name: "Add contact" }).click();
    const contactDrawer = page.getByRole("dialog", { name: "Add contact" });
    await contactDrawer.getByLabel("Full name").fill(CONTACT);
    await contactDrawer.getByRole("button", { name: "Add contact" }).click();
    await expect(contactDrawer.getByRole("alert")).toHaveText("Add at least one way to reach them: email, phone, LinkedIn or website.");
    await contactDrawer.getByLabel("Email").fill("asha@example.test");
    await contactDrawer.getByRole("button", { name: "Add contact" }).click();
    await expect(contactDrawer).toBeHidden();
    await expect(contactRow(page)).toContainText("asha@example.test");
  });

  test("marks the contact do-not-contact after confirming", async ({ page }) => {
    await page.goto(companyUrl);
    await contactRow(page).getByRole("button", { name: `Mark do not contact: ${CONTACT}` }).click();
    await page.getByRole("dialog", { name: "Mark as do not contact?" }).getByRole("button", { name: "Confirm" }).click();
    await expect(contactRow(page).getByText("Do not contact", { exact: true })).toBeVisible();
  });

  test("malformed and unknown company ids show not found", async ({ page }) => {
    await page.goto("/growth/companies/not-a-uuid");
    await expect(page.getByText("Page not found")).toBeVisible();
    await page.goto(`/growth/companies/${UNKNOWN_ID}`);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("company pages offer no search, sort or drag controls", async ({ page }) => {
    await page.goto("/growth/companies");
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sort/i })).toHaveCount(0);
    await expect(page.locator("[draggable=true]")).toHaveCount(0);
  });
});

test.describe("CEO reads Growth without changing it", () => {
  test.use({ storageState: authFile("ceo") });

  test("sees the company and contact with no edit controls", async ({ page }) => {
    await page.goto(companyUrl);
    await expect(page.getByRole("heading", { name: COMPANY })).toBeVisible();
    await expect(contactRow(page)).toBeVisible();
    for (const name of ["Edit company", "Archive company", "Add contact"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(contactRow(page).getByRole("button")).toHaveCount(0);
  });
});

test.describe("CGO archives the company", () => {
  test.use({ storageState: authFile("cgo") });

  test("the company and its contacts become read-only, and direct writes are refused", async ({ page }) => {
    await page.goto(companyUrl);
    await page.getByRole("button", { name: `Archive company ${COMPANY}` }).click();
    await page.getByRole("dialog", { name: "Archive this company?" }).getByRole("button", { name: "Confirm archive" }).click();
    await expect(page.getByText("Archived, read-only.")).toBeVisible();
    for (const name of ["Edit company", "Add contact"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(contactRow(page).getByText("Read-only")).toBeVisible();
    await expect(contactRow(page).getByRole("button")).toHaveCount(0);

    const refused = await page.request.post(`/api/v1/growth/companies/${companyId}/contacts`, {
      headers: { origin: WEB_ORIGIN },
      data: { fullName: "Late Contact", email: "late@example.test" },
    });
    expect(refused.status()).toBe(409);
  });
});

test.describe("CEO after archiving", () => {
  test.use({ storageState: authFile("ceo") });

  test("still sees the archived company and its contacts", async ({ page }) => {
    await page.goto("/growth/companies?archived=true");
    await page.getByRole("link", { name: COMPANY }).click();
    await expect(page.getByText("Archived, read-only.")).toBeVisible();
    await expect(contactRow(page)).toBeVisible();
  });
});

for (const role of ["cfo", "employee"] as const) {
  test.describe(`${role} has no Growth access`, () => {
    test.use({ storageState: authFile(role) });

    test("sees no Growth navigation and is refused Growth pages", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Companies" })).toHaveCount(0);
      await page.goto("/growth/companies");
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
      await page.goto(companyUrl);
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
    });
  });
}
