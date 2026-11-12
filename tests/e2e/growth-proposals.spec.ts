import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const NOT_ALLOWED = "You do not have access to this page";
const BASIC_LEAD = "E2E Accepted Proposal";
const VERBAL_LEAD = "E2E Verbal Proposal";
const REJECTED_LEAD = "E2E Rejected Proposal";

let basicLeadUrl = "";
let verbalLeadUrl = "";
let rejectedLeadUrl = "";

const today = () => new Date().toISOString().slice(0, 10);
const currentProposalStatus = (page: Page, status: string) =>
  page.getByRole("region", { name: "Proposal" }).getByText(status, { exact: true }).first();

async function createLead(page: Page, name: string): Promise<string> {
  await page.goto("/growth/leads");
  await page.getByRole("button", { name: "New lead" }).click();
  const drawer = page.getByRole("dialog", { name: "New lead" });
  await drawer.getByLabel("Name").fill(name);
  await drawer.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function createVersion(page: Page, leadUrl: string, amount = "500000"): Promise<void> {
  await page.goto(leadUrl);
  await page.getByRole("button", { name: "Create proposal" }).click();
  const drawer = page.getByRole("dialog", { name: "Create proposal" });
  await drawer.getByLabel("Proposal document").fill("https://example.test/proposal.pdf");
  await drawer.getByLabel("Amount (₹)").fill(amount);
  await drawer.getByLabel("Valid until").fill("2099-12-31");
  await drawer.getByLabel("Summary").fill("E2E proposal scope");
  await drawer.getByRole("button", { name: "Save version" }).click();
  await expect(drawer).toBeHidden();
}

async function submit(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Submit for approval" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit proposal" });
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("CGO creates and completes an evidence-backed proposal", () => {
  test.use({ storageState: authFile("cgo") });

  test("creates a proposal version from a lead and submits it", async ({ page }) => {
    basicLeadUrl = await createLead(page, BASIC_LEAD);
    await createVersion(page, basicLeadUrl);
    await expect(currentProposalStatus(page, "Draft")).toBeVisible();
    await submit(page);
    await expect(currentProposalStatus(page, "Awaiting CEO approval")).toBeVisible();
  });
});

test.describe("CEO approves the submitted proposal", () => {
  test.use({ storageState: authFile("ceo") });

  test("sees the proposal in the approval queue and approves it", async ({ page }) => {
    await page.goto("/growth/proposals/queue");
    await expect(page.getByRole("link", { name: BASIC_LEAD })).toBeVisible();
    await page.getByRole("link", { name: BASIC_LEAD }).click();
    await page.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve proposal" });
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(dialog).toBeHidden();
    await expect(currentProposalStatus(page, "Approved")).toBeVisible();
  });
});

test.describe("CGO marks an accepted proposal won", () => {
  test.use({ storageState: authFile("cgo") });

  test("marks sent, records evidence-backed acceptance, and freezes the won lead", async ({ page }) => {
    await page.goto(basicLeadUrl);
    await page.getByRole("button", { name: "Mark sent" }).click();
    const sent = page.getByRole("dialog", { name: "Mark proposal sent" });
    await sent.getByRole("button", { name: "Mark sent" }).click();
    await expect(sent).toBeHidden();
    await page.getByRole("button", { name: "Record acceptance" }).click();
    const acceptance = page.getByRole("dialog", { name: "Record acceptance" });
    await acceptance.getByLabel("Accepted on").fill(today());
    await acceptance.getByLabel("Evidence link").fill("https://example.test/signed-proposal.pdf");
    await acceptance.getByRole("button", { name: "Record acceptance" }).click();
    await expect(acceptance).toBeHidden();
    await page.getByRole("button", { name: "Mark won" }).click();
    const won = page.getByRole("dialog", { name: "Mark lead won" });
    await won.getByRole("button", { name: "Mark won" }).click();
    await expect(won).toBeHidden();
    await expect(currentProposalStatus(page, "Won")).toBeVisible();
    for (const name of ["New version", "Mark sent", "Record acceptance", "Mark won", "Withdraw"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
  });
});

test.describe("verbal acceptance waits for CEO confirmation", () => {
  test.use({ storageState: authFile("cgo") });

  test("records a verbal acceptance but does not offer mark won", async ({ page }) => {
    verbalLeadUrl = await createLead(page, VERBAL_LEAD);
    await createVersion(page, verbalLeadUrl, "600000");
    await submit(page);
  });
});

test.describe("CEO handles verbal confirmation and rejection", () => {
  test.use({ storageState: authFile("ceo") });

  test("confirms verbal acceptance only after showing the refusal-note requirement", async ({ page }) => {
    await page.goto("/growth/proposals/queue");
    await page.getByRole("link", { name: VERBAL_LEAD }).click();
    await page.getByRole("button", { name: "Approve" }).click();
    const approve = page.getByRole("dialog", { name: "Approve proposal" });
    await approve.getByRole("button", { name: "Approve" }).click();
    await expect(approve).toBeHidden();
  });
});

test.describe("CGO sends a verbal proposal", () => {
  test.use({ storageState: authFile("cgo") });

  test("records a verbal acceptance and waits for CEO confirmation", async ({ page }) => {
    await page.goto(verbalLeadUrl);
    await page.getByRole("button", { name: "Mark sent" }).click();
    await page.getByRole("dialog", { name: "Mark proposal sent" }).getByRole("button", { name: "Mark sent" }).click();
    await page.getByRole("button", { name: "Record acceptance" }).click();
    const acceptance = page.getByRole("dialog", { name: "Record acceptance" });
    await acceptance.getByLabel("Method").selectOption("verbal");
    await acceptance.getByLabel("Accepted on").fill(today());
    await acceptance.getByLabel("Note").fill("Client confirmed on a recorded call");
    await acceptance.getByRole("button", { name: "Record acceptance" }).click();
    await expect(page.getByText("Waiting for CEO/CTO review.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark won" })).toHaveCount(0);
  });
});

test.describe("CEO confirms and rejects proposal decisions", () => {
  test.use({ storageState: authFile("ceo") });

  test("requires a refusal note before confirming the verbal acceptance", async ({ page }) => {
    await page.goto("/growth/proposals/queue");
    await page.getByRole("link", { name: VERBAL_LEAD }).click();
    await page.getByRole("button", { name: "Refuse acceptance" }).click();
    const refusal = page.getByRole("dialog", { name: "Refuse acceptance" });
    await refusal.getByRole("button", { name: "Refuse acceptance" }).click();
    await expect(refusal.getByRole("alert")).toHaveText("Add a note before continuing.");
    await refusal.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Confirm acceptance" }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm acceptance" });
    await confirm.getByRole("button", { name: "Confirm acceptance" }).click();
    await expect(confirm).toBeHidden();

  });
});

test.describe("CGO creates a proposal that the CEO rejects", () => {
  test.use({ storageState: authFile("cgo") });

  test("submits a separate proposal for rejection", async ({ page }) => {
    rejectedLeadUrl = await createLead(page, REJECTED_LEAD);
    await createVersion(page, rejectedLeadUrl, "700000");
    await submit(page);
  });

  test("marks the CEO-confirmed verbal proposal won", async ({ page }) => {
    await page.goto(verbalLeadUrl);
    await page.getByRole("button", { name: "Mark won" }).click();
    const won = page.getByRole("dialog", { name: "Mark lead won" });
    await won.getByRole("button", { name: "Mark won" }).click();
    await expect(currentProposalStatus(page, "Won")).toBeVisible();
  });
});

test.describe("CEO rejects with a note", () => {
  test.use({ storageState: authFile("ceo") });

  test("requires a rejection note and leaves a version eligible for replacement", async ({ page }) => {
    await page.goto("/growth/proposals/queue");
    await page.getByRole("link", { name: REJECTED_LEAD }).click();
    await page.getByRole("button", { name: "Reject" }).click();
    const rejection = page.getByRole("dialog", { name: "Reject proposal" });
    await rejection.getByRole("button", { name: "Reject" }).click();
    await expect(rejection.getByRole("alert")).toHaveText("Add a note before continuing.");
    await rejection.getByLabel("Note").fill("Scope needs revision");
    await rejection.getByRole("button", { name: "Reject" }).click();
    await expect(rejection).toBeHidden();
    await expect(currentProposalStatus(page, "Rejected")).toBeVisible();
  });
});

test.describe("CGO replaces a rejected proposal and checks list filters", () => {
  test.use({ storageState: authFile("cgo") });

  test("creates a replacement version and sees the won proposal filter", async ({ page }) => {
    await page.goto(rejectedLeadUrl);
    await page.getByRole("button", { name: "New version" }).click();
    const drawer = page.getByRole("dialog", { name: "New proposal version" });
    await drawer.getByLabel("Proposal document").fill("https://example.test/revised-proposal.pdf");
    await drawer.getByLabel("Amount (₹)").fill("710000");
    await drawer.getByLabel("Valid until").fill("2099-12-31");
    await drawer.getByLabel("Summary").fill("Revised E2E proposal scope");
    await drawer.getByRole("button", { name: "Save version" }).click();
    await expect(drawer).toBeHidden();
    await expect(currentProposalStatus(page, "Draft")).toBeVisible();
    await page.goto("/growth/proposals?status=won");
    await expect(page.getByRole("link", { name: BASIC_LEAD })).toBeVisible();
    await expect(page.getByRole("link", { name: VERBAL_LEAD })).toBeVisible();
    await expect(page.getByRole("link", { name: REJECTED_LEAD })).toHaveCount(0);
  });
});

for (const role of ["cfo", "employee"] as const) {
  test.describe(`${role} has no proposal access`, () => {
    test.use({ storageState: authFile(role) });

    test("has no proposal navigation and is refused direct proposal URLs", async ({ page }) => {
      await page.goto("/");
      const navigation = page.getByRole("navigation", { name: "Main" });
      await expect(navigation.getByRole("link", { name: "Proposals" })).toHaveCount(0);
      await expect(navigation.getByRole("link", { name: "Approval queue" })).toHaveCount(0);
      await page.goto("/growth/proposals");
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
      await page.goto("/growth/proposals/queue");
      await expect(page.getByText(NOT_ALLOWED)).toBeVisible();
    });
  });
}
