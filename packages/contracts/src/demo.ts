import type { Role } from "@crm/permissions";

/** The one message for every write refused by the public read-only demo. */
export const DEMO_READ_ONLY_MESSAGE = "This public demo is read-only.";

/** The banner shown on every page of the public demo. */
export const DEMO_BANNER_TEXT = "Demo data — changes are not saved";

export interface DemoAccount {
  email: string;
  name: string;
  role: Role;
  /** Short label for the login page. */
  label: string;
}

/**
 * Fictional public demo accounts, one per showcased role. Emails use the reserved example.test domain.
 * Passwords are never stored here: the seed takes DEMO_ACCOUNT_PASSWORD from its environment.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: "ceo@example.test", name: "Avery Quinn", role: "ceo_cto", label: "CEO/CTO" },
  { email: "cgo@example.test", name: "Jordan Ellis", role: "cgo", label: "Growth (CGO)" },
  { email: "cmo@example.test", name: "Riley Moreno", role: "cmo", label: "Marketing (CMO)" },
  { email: "cfo@example.test", name: "Morgan Patel", role: "cfo", label: "Finance (CFO)" },
  { email: "vp@example.test", name: "Casey Nakamura", role: "vp_engineering_quality", label: "VP Engineering & Quality" },
  { email: "employee@example.test", name: "Sam Okafor", role: "employee", label: "Employee" },
  { email: "intern@example.test", name: "Taylor Brooks", role: "intern", label: "Intern" },
];
