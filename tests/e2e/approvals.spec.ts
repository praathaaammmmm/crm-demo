import { expect, test, type Page } from "@playwright/test";
import { authFile, USERS } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const rowFor = (page: Page, targetName: string) => page.getByRole("row").filter({ hasText: `For ${targetName}` });

test.describe("CFO (requester)", () => {
  test.use({ storageState: authFile("cfo") });

  test("sees only own requests, with Cancel but no Approve or Reject", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    // The CGO's request is not visible to the CFO.
    await expect(rowFor(page, USERS.targetReject.name)).toHaveCount(0);
  });

  test("cancels their own pending request", async ({ page }) => {
    await page.goto("/approvals");
    const row = rowFor(page, USERS.targetCancel.name);
    await row.getByRole("button", { name: "Cancel request" }).click();
    await row.getByRole("button", { name: "Confirm cancel" }).click();
    await expect(rowFor(page, USERS.targetCancel.name)).toHaveCount(0);

    await page.goto("/approvals?status=cancelled");
    await expect(rowFor(page, USERS.targetCancel.name).getByText("Cancelled")).toBeVisible();
  });
});

test.describe("CEO", () => {
  test.use({ storageState: authFile("ceo") });

  test("approves a pending role change", async ({ page }) => {
    await page.goto("/approvals");
    const row = rowFor(page, USERS.targetApprove.name);
    await row.getByRole("button", { name: "Approve" }).click();
    await row.getByRole("button", { name: "Confirm approval" }).click();
    await expect(rowFor(page, USERS.targetApprove.name)).toHaveCount(0);

    await page.goto("/approvals?status=approved");
    await expect(rowFor(page, USERS.targetApprove.name).getByText("Approved")).toBeVisible();
  });

  test("must give a note to reject, then the request shows as rejected", async ({ page }) => {
    await page.goto("/approvals");
    const row = rowFor(page, USERS.targetReject.name);
    await row.getByRole("button", { name: "Reject" }).click();
    await row.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(row.getByRole("alert")).toHaveText("A note is required to reject a request.");

    await row.getByLabel("Reason for rejection (required)").fill("Still needed this quarter");
    await row.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(rowFor(page, USERS.targetReject.name)).toHaveCount(0);

    await page.goto("/approvals?status=rejected");
    const rejected = rowFor(page, USERS.targetReject.name);
    await expect(rejected.getByText("Rejected")).toBeVisible();
    await expect(rejected.getByText("Still needed this quarter")).toBeVisible();
  });
});
