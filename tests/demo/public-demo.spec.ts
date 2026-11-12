import { DEMO_ACCOUNTS, DEMO_BANNER_TEXT, DEMO_READ_ONLY_MESSAGE } from "@crm/contracts/demo";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { navItemsFor } from "../../apps/web/src/lib/navigation.ts";

/** Set by the runner from a random per-run value. Never printed: only compared as booleans. */
const PASSWORD = process.env["DEMO_E2E_PASSWORD"] ?? "";
const account = (role: string) => {
  const found = DEMO_ACCOUNTS.find((candidate) => candidate.role === role);
  if (!found) throw new Error(`No demo account for ${role}`);
  return found;
};

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

type SessionState = Awaited<ReturnType<BrowserContext["storageState"]>>;
/**
 * Signed-in browser state per account, kept in memory only (never written to disk), so the whole run signs
 * in once per role and stays below the API's 10-logins-per-minute limit.
 */
const sessions = new Map<string, SessionState>();

/** A page signed in as `email`, reusing the in-memory session when there is one. */
async function pageAs(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const known = sessions.get(email);
  const context = await browser.newContext(known ? { storageState: known } : {});
  const page = await context.newPage();
  if (!known) {
    await signIn(page, email);
    sessions.set(email, await context.storageState());
  }
  return { page, close: () => context.close() };
}

/** The visible inline error notice carrying the read-only message (not Next's hidden route announcer). */
const readOnlyNotice = (page: Page) => page.getByRole("alert").filter({ hasText: DEMO_READ_ONLY_MESSAGE });

const banner = (page: Page) => page.getByRole("status").filter({ hasText: DEMO_BANNER_TEXT });

const DASHBOARD_PATHS = new Set(["/", "/growth", "/marketing", "/operations", "/quality"]);

/**
 * Waits until a streamed page has finished: network quiet, no loading skeleton (aria-busy), and rendered
 * content. Dashboards must show at least one panel; other pages a table, list, panel or empty state.
 * Fails the test (rather than measuring a loading page) when that never happens.
 */
async function waitForContent(page: Page, path: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const content = DASHBOARD_PATHS.has(path)
    ? page.locator("main section[aria-labelledby]")
    : page.locator('main :is(section, table, ul, [class*="_emptyTitle"])');
  await expect(content.first(), `${path} rendered no content`).toBeVisible();
}

async function countItems(page: Page, path: string): Promise<number> {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { items: unknown[] }).items.length;
}

test("login page shows the demo banner and every demo account", async ({ page }) => {
  await page.goto("/login");
  await expect(banner(page)).toBeVisible();
  for (const demo of DEMO_ACCOUNTS) await expect(page.getByText(demo.email, { exact: true })).toBeVisible();
});

test("login page shows the configured public demo password", async ({ page }) => {
  expect(PASSWORD.length > 0).toBe(true);
  await page.goto("/login");
  expect((await page.content()).includes(PASSWORD)).toBe(true);
});

for (const demo of DEMO_ACCOUNTS) {
  test(`${demo.label} signs in and sees the banner and role navigation`, async ({ page, context }) => {
    await signIn(page, demo.email);
    sessions.set(demo.email, await context.storageState());
    await expect(banner(page)).toBeVisible();
    const labels = (await page.getByRole("navigation", { name: "Main" }).getByRole("link").allTextContents()).map((text) => text.trim());
    expect(labels).toEqual(navItemsFor(demo.role).map((item) => item.label));
  });
}

test("CEO/CTO creating a task is refused and nothing changes", async ({ browser }) => {
  const { page, close } = await pageAs(browser, account("ceo_cto").email);
  const before = await countItems(page, "/api/v1/tasks?limit=50");
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  await page.locator("#task-project").selectOption({ index: 1 });
  await page.locator("#task-title").fill("Should not be saved");
  await page.locator("#task-due").fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  await page.locator("#task-assignee").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(readOnlyNotice(page)).toBeVisible();
  await expect(readOnlyNotice(page)).toHaveText(DEMO_READ_ONLY_MESSAGE);
  await page.reload();
  expect(await countItems(page, "/api/v1/tasks?limit=50")).toBe(before);
  await close();
});

test("CGO creating a company is refused and nothing changes", async ({ browser }) => {
  const { page, close } = await pageAs(browser, account("cgo").email);
  const before = await countItems(page, "/api/v1/growth/companies");
  await page.goto("/growth/companies");
  await page.getByRole("button", { name: "New company" }).click();
  await page.getByLabel("Name").fill("Should not be saved");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(readOnlyNotice(page)).toBeVisible();
  await expect(readOnlyNotice(page)).toHaveText(DEMO_READ_ONLY_MESSAGE);
  await page.reload();
  expect(await countItems(page, "/api/v1/growth/companies")).toBe(before);
  await close();
});

test("CEO/CTO approving a request is refused and it stays pending", async ({ browser }) => {
  const { page, close } = await pageAs(browser, account("ceo_cto").email);
  expect(await countItems(page, "/api/v1/approvals?status=pending")).toBe(1);
  await page.goto("/approvals");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(readOnlyNotice(page)).toBeVisible();
  await expect(readOnlyNotice(page)).toHaveText(DEMO_READ_ONLY_MESSAGE);
  await page.reload();
  expect(await countItems(page, "/api/v1/approvals?status=pending")).toBe(1);
  await close();
});

test("password change requests are refused by the API", async ({ browser }) => {
  const { page, close } = await pageAs(browser, account("employee").email);
  const response = await page.request.post("/api/v1/auth/password", {
    data: { currentPassword: PASSWORD, newPassword: "another-demo-password-1" },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ code: "DEMO_READ_ONLY", message: DEMO_READ_ONLY_MESSAGE });
  await close();
});


test("every main record page has seeded data", async ({ browser }) => {
  const { page, close } = await pageAs(browser, account("ceo_cto").email);
  const pages = [
    "/", "/tasks", "/projects", "/meetings", "/quality", "/defects", "/approvals", "/users",
    "/growth", "/growth/leads", "/growth/companies", "/growth/proposals",
    "/marketing", "/marketing/campaigns", "/marketing/content",
    "/operations", "/operations/incidents", "/operations/releases", "/operations/automations",
  ];
  const empty: string[] = [];
  for (const path of pages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await waitForContent(page, path);
    // EmptyState's title class; production CSS modules name it like "<hash>_emptyTitle".
    if ((await page.locator('main [class*="_emptyTitle"]').count()) > 0) empty.push(path);
  }
  expect(empty).toEqual([]);
  await close();
});

test("sign-out still works", async ({ browser }) => {
  const { page, close } = await pageAs(browser, account("cfo").email);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  sessions.delete(account("cfo").email);
  await close();
});

/**
 * Visual inspection without screenshots: prints each chart as text (title, row labels, printed values) and
 * checks layout at desktop and phone widths. Prints only fictional demo data, never credentials.
 */
const INSPECT_DIR = path.join(import.meta.dirname, ".results");
const INSPECT_FILE = path.join(INSPECT_DIR, "inspect.txt");
const DASHBOARDS = [
  { role: "ceo_cto", path: "/" },
  { role: "cgo", path: "/growth" },
  { role: "cmo", path: "/marketing" },
  { role: "vp_engineering_quality", path: "/operations" },
  { role: "vp_engineering_quality", path: "/quality" },
] as const;

for (const dashboard of DASHBOARDS) {
  test(`inspect charts on ${dashboard.path} as ${dashboard.role}`, async ({ browser }) => {
    const { page, close } = await pageAs(browser, account(dashboard.role).email);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(dashboard.path);
      expect(response?.status()).toBe(200);
      await waitForContent(page, dashboard.path);
      const report = await page.evaluate(() => {
        const text = (el: Element | null | undefined): string => (el ? el.textContent.trim() : "");
        const overlaps = (a: DOMRect, b: DOMRect) => a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1;
        const issues: string[] = [];
        const charts: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push(`page scrolls horizontally (${String(document.documentElement.scrollWidth)}px > ${String(window.innerWidth)}px)`);
        for (const panel of document.querySelectorAll("main section[aria-labelledby]")) {
          const title = text(panel.querySelector("h2")) || "(untitled)";
          const lists = panel.querySelectorAll("ul[aria-label]");
          const empty = lists.length === 0 ? text(panel.querySelector("p")) : undefined;
          const total = [...panel.querySelectorAll("p")].map((p) => text(p)).find((t) => /^\d/.test(t));
          const rows: string[] = [];
          for (const list of lists) {
            for (const item of list.querySelectorAll(":scope > li")) {
              const spans = [...item.querySelectorAll(":scope > span, :scope > span > span, :scope > span > a")].filter((el) => el.children.length === 0 && text(el) !== "");
              rows.push(spans.map((el) => text(el)).join(" | "));
              for (const el of spans) {
                const node = el as HTMLElement;
                const clipped = node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
                if (clipped && getComputedStyle(node).overflow === "hidden") issues.push(`${title}: "${text(node)}" is truncated`);
              }
              const first = spans.at(0);
              const last = spans.at(-1);
              if (first && last && first !== last && overlaps(first.getBoundingClientRect(), last.getBoundingClientRect())) {
                issues.push(`${title}: label and value overlap`);
              }
            }
          }
          // Chart images (donut SVG, stacked bar) must carry a screen-reader label.
          const images = [...panel.querySelectorAll('[role="img"]')];
          const unlabelled = images.filter((image) => (image.getAttribute("aria-label") ?? "").trim() === "").length;
          if (unlabelled > 0) issues.push(`${title}: ${String(unlabelled)} chart image(s) without an accessible label`);
          const kinds = images.length > 0 ? ` {img=${String(images.length)}${panel.querySelector("svg[role=img]") ? " donut" : ""}${panel.querySelector('div[role="img"]') ? " stacked" : ""}}` : "";
          if (lists.length > 0 || empty) charts.push(`${title}${kinds}${total ? ` [${total}]` : ""}: ${rows.length > 0 ? rows.join(" ; ") : `(empty: ${empty ?? ""})`}`);
        }
        return { charts, issues };
      });
      // Written to a temporary results file (removed by the runner's cleanup); console output is unreliable.
      const lines = [
        `INSPECT ${dashboard.path} @${String(width)} panels=${String(report.charts.length)} issues=${String(report.issues.length)}`,
        ...report.charts.map((chart) => `INSPECT ${dashboard.path} @${String(width)} ${chart}`),
        ...report.issues.map((issue) => `INSPECT-ISSUE ${dashboard.path} @${String(width)} ${issue}`),
      ];
      mkdirSync(INSPECT_DIR, { recursive: true });
      appendFileSync(INSPECT_FILE, `${lines.join("\n")}\n`);
      expect(report.charts.length, `${dashboard.path} @${String(width)} found no panels`).toBeGreaterThan(0);
      // Any layout issue at either width fails: horizontal scroll, overlap, or a cut-off label.
      expect(report.issues, `${dashboard.path} @${String(width)} layout issues`).toEqual([]);
    }
    await close();
  });
}
