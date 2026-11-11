import { expect, test } from "@playwright/test";
import { signInThroughUi, USERS } from "./fixtures.js";

const NEW_PASSWORD = "e2e-chosen-new-password";

test("a user with a temporary password must change it before using the app", async ({ page }) => {
  await signInThroughUi(page, USERS.newUser);
  await expect(page).toHaveURL(/\/change-password$/);

  for (const blocked of ["/", "/users", "/approvals"]) {
    await page.goto(blocked);
    await expect(page).toHaveURL(/\/change-password$/);
  }

  await page.getByLabel("Current (temporary) password").fill(USERS.newUser.password);
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Repeat new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: `Welcome, ${USERS.newUser.name}` })).toBeVisible();

  // Normal role permissions now apply: an employee sees Home, My tasks, Projects and Defects.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Home", "My tasks", "Projects", "Defects"]);

  // The gate page is no longer reachable once the change is done.
  await page.goto("/change-password");
  await expect(page).toHaveURL(/\/$/);
});
