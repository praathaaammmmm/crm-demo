import { expect, test, type Page } from "@playwright/test";
import { authFile, USERS } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

const TITLE = "E2E Planning";
const RENAMED = "E2E Planning (renamed)";
const REMINDER_TITLE = "E2E Reminder";
const MINUTE = 60_000;

let meetingUrl = "";

/** The organisation's time zone, loaded from the environment by global setup. */
const timeZone = () => {
  const zone = process.env["ORG_TIMEZONE"];
  if (!zone) throw new Error("ORG_TIMEZONE is not set");
  return zone;
};

/** "YYYY-MM-DDTHH:MM" for an instant, in the organisation's time zone. */
function localInput(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  return `${parts["year"] ?? ""}-${parts["month"] ?? ""}-${parts["day"] ?? ""}T${parts["hour"] ?? ""}:${parts["minute"] ?? ""}`;
}

/** Monday of the week containing a "YYYY-MM-DD" day. */
function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

const rail = (page: Page) => page.getByRole("complementary", { name: "Meeting details" });
const attendeeRow = (page: Page, name: string) => page.getByRole("list", { name: "Attendees" }).getByRole("listitem").filter({ hasText: name });

async function schedule(page: Page, title: string, startsAtLocal: string, attendees: string[]): Promise<void> {
  await page.goto("/meetings");
  await page.getByRole("button", { name: "New meeting" }).click();
  const drawer = page.getByRole("dialog", { name: "New meeting" });
  await drawer.getByLabel("Title").fill(title);
  await drawer.getByLabel("Starts").fill(startsAtLocal);
  await drawer.getByLabel("Duration (minutes)").fill("30");
  for (const name of attendees) await drawer.getByLabel(name).check();
  await drawer.getByRole("button", { name: "Schedule meeting" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function editMeeting(page: Page, change: (drawer: ReturnType<Page["getByRole"]>) => Promise<void>): Promise<void> {
  await page.goto(meetingUrl);
  await rail(page).getByRole("button", { name: "Edit meeting" }).click();
  const drawer = page.getByRole("dialog", { name: "Edit meeting" });
  await change(drawer);
  await drawer.getByRole("button", { name: "Save changes" }).click();
  await expect(drawer).toBeHidden();
}

// Two days ahead at 10:00 local, so the meeting is in the future regardless of the time of day.
const firstStart = () => `${localInput(Date.now() + 2 * 24 * 60 * MINUTE).slice(0, 10)}T10:00`;

test.describe("CEO schedules", () => {
  test.use({ storageState: authFile("ceo") });

  test("schedules a meeting with attendees from the drawer", async ({ page }) => {
    await schedule(page, TITLE, firstStart(), [USERS.employee.name, USERS.vp.name]);
    meetingUrl = new URL(page.url()).pathname;
    await expect(attendeeRow(page, USERS.employee.name).getByText("Awaiting response")).toBeVisible();
    await expect(attendeeRow(page, USERS.vp.name)).toBeVisible();
  });

  test("meeting pages offer no search or sort controls", async ({ page }) => {
    await page.goto("/meetings");
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sort/i })).toHaveCount(0);
  });
});

test.describe("employee sees and accepts", () => {
  test.use({ storageState: authFile("employee") });

  test("sees the meeting in Agenda and Week, and accepts", async ({ page }) => {
    await page.goto("/meetings");
    await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toBeVisible();
    await page.goto(`/meetings?view=week&week=${mondayOf(firstStart().slice(0, 10))}`);
    await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toBeVisible();

    await page.goto(meetingUrl);
    await rail(page).getByRole("button", { name: "Accept" }).click();
    await expect(rail(page).getByText("Accepted", { exact: true })).toBeVisible();
  });
});

test.describe("CFO is not invited", () => {
  test.use({ storageState: authFile("cfo") });

  test("gets not found on the meeting URL", async ({ page }) => {
    await page.goto(meetingUrl);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});

test.describe("CEO edits details only", () => {
  test.use({ storageState: authFile("ceo") });

  test("a title-only edit keeps responses and shows no reset notice", async ({ page }) => {
    await editMeeting(page, (drawer) => drawer.getByLabel("Title").fill(RENAMED));
    await expect(page.getByRole("heading", { name: RENAMED })).toBeVisible();
    await expect(attendeeRow(page, USERS.employee.name).getByText("Accepted")).toBeVisible();
    await expect(rail(page).getByText(/Responses were reset/)).toHaveCount(0);
  });

  test("a time change resets responses and shows the notice", async ({ page }) => {
    const later = firstStart().replace("T10:00", "T11:30");
    await editMeeting(page, (drawer) => drawer.getByLabel("Starts").fill(later));
    await expect(attendeeRow(page, USERS.employee.name).getByText("Awaiting response")).toBeVisible();
    await expect(page.getByText(/Responses were reset after rescheduling/)).toBeVisible();
  });
});

test.describe("employee after the reschedule", () => {
  test.use({ storageState: authFile("employee") });

  test("sees the reset and accepts again", async ({ page }) => {
    await page.goto(meetingUrl);
    await expect(rail(page).getByText("Awaiting response", { exact: true })).toBeVisible();
    await expect(page.getByText(/Responses were reset after rescheduling/)).toBeVisible();
    await rail(page).getByRole("button", { name: "Accept" }).click();
    await expect(rail(page).getByText("Accepted", { exact: true })).toBeVisible();
  });
});

test.describe("CEO replaces attendees and cancels", () => {
  test.use({ storageState: authFile("ceo") });

  test("retained people keep their response, new people are pending, removed people lose access", async ({ page, browser }) => {
    await editMeeting(page, async (drawer) => {
      await drawer.getByLabel(USERS.vp.name).uncheck();
      await drawer.getByLabel(USERS.cgo.name).check();
    });
    await expect(attendeeRow(page, USERS.employee.name).getByText("Accepted")).toBeVisible();
    await expect(attendeeRow(page, USERS.cgo.name).getByText("Awaiting response")).toBeVisible();
    await expect(attendeeRow(page, USERS.vp.name)).toHaveCount(0);

    const vp = await browser.newContext({ storageState: authFile("vp") });
    try {
      const vpPage = await vp.newPage();
      await vpPage.goto(meetingUrl);
      await expect(vpPage.getByText("Page not found")).toBeVisible();
    } finally {
      await vp.close();
    }
  });

  test("cancels the meeting, which becomes read-only", async ({ page }) => {
    await page.goto(meetingUrl);
    await rail(page).getByRole("button", { name: "Cancel meeting" }).click();
    await page.getByRole("dialog", { name: "Cancel this meeting?" }).getByRole("button", { name: "Confirm cancel" }).click();
    await expect(rail(page).getByText("This meeting was cancelled and is read-only.")).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Edit meeting" })).toHaveCount(0);
  });

  test("dashboard shows meeting counts", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Meetings", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Cancelled \(7 days\)/ })).toContainText("1");
  });
});

test.describe("reminder through the real worker", () => {
  test.use({ storageState: authFile("ceo") });

  test("the employee gets the 2-minute reminder, and no 10- or 5-minute reminder", async ({ page, browser }) => {
    test.setTimeout(90_000);
    // Start 2:10–3:10 minutes from now: the 10- and 5-minute reminders are already past and skipped,
    // and the 2-minute reminder is due 10–70 seconds after the meeting is created.
    const start = Math.ceil((Date.now() + 10_000) / MINUTE) * MINUTE + 2 * MINUTE;
    await schedule(page, REMINDER_TITLE, localInput(start), [USERS.employee.name]);

    // The worker polls every 2 seconds; wait past the reminder time with a margin, then check the page.
    const deadline = start - 2 * MINUTE + 5_000;
    const wait = deadline - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);

    const employee = await browser.newContext({ storageState: authFile("employee") });
    try {
      const employeePage = await employee.newPage();
      await expect(async () => {
        await employeePage.goto("/notifications");
        await expect(employeePage.getByText(`${REMINDER_TITLE} starts in 2 minutes`)).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(employeePage.getByText(`${REMINDER_TITLE} starts in 10 minutes`)).toHaveCount(0);
      await expect(employeePage.getByText(`${REMINDER_TITLE} starts in 5 minutes`)).toHaveCount(0);
    } finally {
      await employee.close();
    }
  });
});
