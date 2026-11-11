import { expect, test } from "@playwright/test";
import { signInThroughUi, USERS } from "./fixtures.js";

test.describe.configure({ mode: "serial" });

test("a signed-out visit to /users goes to /login", async ({ page }) => {
  await page.goto("/users");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a wrong password shows one generic message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.authUser.email);
  await page.getByLabel("Password").fill("not-the-right-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Next.js also renders a role="alert" route announcer, so match the form's alert by its exact text.
  await expect(page.getByRole("alert").filter({ hasText: /^Invalid email or password\.$/ })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("signs in, then signs out and can no longer reach the app", async ({ page }) => {
  await signInThroughUi(page, USERS.authUser);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: `Welcome, ${USERS.authUser.name}` })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
