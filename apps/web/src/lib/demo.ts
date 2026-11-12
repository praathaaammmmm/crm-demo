import { DEMO_ACCOUNTS, type DemoAccount } from "@crm/contracts/demo";

/**
 * Server-side only. The public demo is on when DEMO_MODE is exactly "true". This only changes what the
 * page shows: the API enforces read-only mode on its own.
 */
export function isDemoMode(): boolean {
  return process.env["DEMO_MODE"] === "true";
}

/**
 * The public demo accounts to show on the login page. The shared password is intentionally public
 * (DEMO_LOGIN_PASSWORD, server-side) because the demo API refuses every write; null hides it.
 */
export function demoLogin(): { accounts: readonly DemoAccount[]; password: string | null } | null {
  if (!isDemoMode()) return null;
  const password = process.env["DEMO_LOGIN_PASSWORD"]?.trim();
  return { accounts: DEMO_ACCOUNTS, password: password ? password : null };
}
