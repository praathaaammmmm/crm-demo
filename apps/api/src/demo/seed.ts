/**
 * Seeds a dedicated, freshly migrated public-demo database with fictional data. Run once, by hand:
 *
 *   DEMO_SEED_CONFIRM=<database name> node dist/src/demo/seed.js
 *
 * Refuses to run unless the target database is named crm_demo or crm_demo_<suffix>, matches
 * DEMO_SEED_CONFIRM on both connections, and has no users. Accounts are inserted as crm_migrator
 * (like the Super Admin bootstrap); every business record is created through the real API in-process,
 * with demo mode off, so permissions, validation, transitions and audit all apply.
 * Never prints connection strings, passwords, tokens or database error text.
 */
import { pathToFileURL } from "node:url";
import { DEMO_ACCOUNTS } from "@crm/contracts/demo";
import { createDatabase, type Database } from "@crm/database/client";
import type { Role } from "@crm/permissions";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildApp } from "../app.js";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../modules/identity/index.js";
import { BOOTSTRAP_CONFIRMATION, bootstrapSuperAdmin } from "../modules/organization/index.js";
import { isTimeZone } from "../platform/env.js";

/** Never sent anywhere: requests are injected in-process and only need a matching Origin header. */
const SEED_ORIGIN = "http://demo-seed.invalid";
const DEMO_DATABASE_NAME = /^crm_demo(_[a-z0-9_]{1,40})?$/;

const seedEnvSchema = z.object({
  DATABASE_URL_MIGRATOR: z.string().min(1),
  DATABASE_URL_APP: z.string().min(1),
  DEMO_SEED_CONFIRM: z.string().min(1),
  DEMO_ACCOUNT_PASSWORD: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  ORG_TIMEZONE: z.string().refine(isTimeZone),
});
type SeedEnv = z.infer<typeof seedEnvSchema>;

class SeedError extends Error {}

function loadSeedEnv(source: NodeJS.ProcessEnv): SeedEnv {
  const result = seedEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new SeedError(`Invalid or missing environment variables: ${names}`);
  }
  return result.data;
}

/** Pure guard: the only databases this script will ever write to. Returns a safe reason, or null when allowed. */
export function seedTargetProblem(target: { database: string; confirm: string; userCount: number }): string | null {
  if (!DEMO_DATABASE_NAME.test(target.database)) return "Target database is not a crm_demo database";
  if (target.confirm !== target.database) return "DEMO_SEED_CONFIRM does not match the target database";
  if (target.userCount !== 0) return "Target database already has users; reset it before seeding";
  return null;
}

async function currentDatabase(db: Database): Promise<string> {
  const result = await db.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  return result.rows[0]?.name ?? "";
}

async function assertSafeTarget(migrator: Database, app: Database, confirm: string): Promise<void> {
  const database = await currentDatabase(migrator);
  if ((await currentDatabase(app)) !== database) throw new SeedError("The two connections point at different databases");
  const counted = await migrator.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM users`);
  const problem = seedTargetProblem({ database, confirm, userCount: Number(counted.rows[0]?.n ?? "1") });
  if (problem) throw new SeedError(problem);
}

async function insertUser(migrator: Database, email: string, name: string, role: Role, passwordHash: string): Promise<string> {
  // The database trigger sets the reporting line to the CEO/CTO.
  const result = await migrator.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, role, password_hash, must_change_password)
    VALUES (${email}, ${name}, ${role}::user_role, ${passwordHash}, false)
    RETURNING id
  `);
  const id = result.rows[0]?.id;
  if (!id) throw new SeedError("User insert returned no row");
  return id;
}

/** Dates relative to the seed day in the organisation's time zone, so the demo always looks current. */
function clock(timeZone: string) {
  const parts = (date: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
  const shifted = (days: number) => new Date(Date.now() + days * 86_400_000);
  return {
    day: (days: number) => {
      const p = parts(shifted(days));
      return `${p["year"] ?? ""}-${p["month"] ?? ""}-${p["day"] ?? ""}`;
    },
    /** Local wall-clock "YYYY-MM-DDTHH:MM" on a day offset, at a fixed time. */
    local: (days: number, time: string) => {
      const p = parts(shifted(days));
      return `${p["year"] ?? ""}-${p["month"] ?? ""}-${p["day"] ?? ""}T${time}`;
    },
    iso: (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString(),
  };
}

type Key = "ceo" | "cgo" | "cmo" | "cfo" | "vp" | "employee" | "intern";
const KEY_BY_ROLE: Partial<Record<Role, Key>> = {
  ceo_cto: "ceo",
  cgo: "cgo",
  cmo: "cmo",
  cfo: "cfo",
  vp_engineering_quality: "vp",
  employee: "employee",
  intern: "intern",
};

/** In-process API client for the seed. Fails loudly with the route and status only. */
function client(app: FastifyInstance) {
  const tokens = new Map<Key, string>();
  return {
    async login(key: Key, email: string, password: string) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: SEED_ORIGIN },
        payload: { email, password },
      });
      const token = response.cookies.find((cookie) => cookie.name === "crm_session")?.value;
      if (response.statusCode !== 200 || !token) throw new SeedError(`Seed login failed with status ${String(response.statusCode)}`);
      tokens.set(key, token);
    },
    /** POSTs as a demo user and returns `body[field].id` when `field` is given. */
    async post(key: Key, path: string, payload: object, field?: string): Promise<string> {
      const token = tokens.get(key);
      if (token === undefined) throw new SeedError("Seed user is not signed in");
      const response = await app.inject({
        method: "POST",
        url: `/api/v1${path}`,
        headers: { origin: SEED_ORIGIN },
        cookies: { crm_session: token },
        payload,
      });
      if (response.statusCode !== 200 && response.statusCode !== 201) {
        throw new SeedError(`Seed request POST ${path.replace(/[0-9a-f-]{36}/g, ":id")} failed with status ${String(response.statusCode)}`);
      }
      if (field === undefined) return "";
      const body = response.json<Record<string, { id?: unknown } | undefined>>();
      const id = body[field]?.id;
      if (typeof id !== "string") throw new SeedError(`Seed response had no ${field} id`);
      return id;
    },
  };
}

async function seedContent(api: ReturnType<typeof client>, ids: Record<Key, string>, when: ReturnType<typeof clock>, migrator: Database) {
  // Projects and tasks (the CEO/CTO alone creates and reviews tasks).
  const project = (name: string, description: string) => api.post("ceo", "/projects", { name, description }, "project");
  const portal = await project("Client Portal", "Self-service portal for Northwind Labs customers.");
  const billing = await project("Billing Revamp", "New invoicing flow and pricing tiers.");
  const mobile = await project("Field App", "iOS and Android app for field teams.");

  const task = (projectId: string, title: string, assignee: Key, priority: string, due: number) =>
    api.post("ceo", "/tasks", { projectId, title, priority, dueDate: when.day(due), assigneeId: ids[assignee], description: `${title}.` }, "task");
  const start = (who: Key, id: string) => api.post(who, `/tasks/${id}/status`, { status: "in_progress" });
  const submit = async (who: Key, id: string, url: string) => {
    await api.post(who, `/tasks/${id}/proofs`, { url, note: "Ready for review" });
    await api.post(who, `/tasks/${id}/submit`, {});
  };

  const design = await task(portal, "Design sign-in page", "employee", "medium", 10);
  const profile = await task(portal, "Build profile settings", "employee", "high", 5);
  await start("employee", profile);
  await api.post("employee", `/tasks/${profile}/updates`, { note: "Avatar upload works; saving preferences next." });
  const payment = await task(portal, "Integrate payment sandbox", "employee", "urgent", 7);
  await start("employee", payment);
  await api.post("employee", `/tasks/${payment}/status`, { status: "blocked", note: "Waiting for sandbox access." });
  const onboarding = await task(portal, "Write onboarding emails", "intern", "medium", 6);
  await start("intern", onboarding);
  await submit("intern", onboarding, "https://example.test/onboarding-draft");
  const timeout = await task(portal, "Fix session timeout", "employee", "high", 4);
  await start("employee", timeout);
  await submit("employee", timeout, "https://example.test/session-fix");
  await api.post("ceo", `/tasks/${timeout}/review`, { decision: "changes_requested", note: "Please add a test for the 12-hour limit." });
  const ci = await task(mobile, "Set up CI pipeline", "vp", "medium", 8);
  await start("vp", ci);
  await submit("vp", ci, "https://example.test/ci-run");
  await api.post("ceo", `/tasks/${ci}/review`, { decision: "approved" });
  const invoices = await task(billing, "Reconcile invoice exports", "cfo", "high", 9);
  await start("cfo", invoices);
  await task(billing, "Review pricing tiers", "cgo", "low", 14);
  await task(billing, "Draft launch announcement", "cmo", "medium", 12);
  const checklist = await task(mobile, "Release checklist", "employee", "medium", 3);
  await start("employee", checklist);
  await submit("employee", checklist, "https://example.test/release-checklist");
  await api.post("ceo", `/tasks/${checklist}/review`, { decision: "approved" });

  // The API refuses past due dates; one task is made overdue directly. The target was verified as crm_demo*.
  await migrator.execute(sql`UPDATE tasks SET due_date = current_date - 2 WHERE id = ${profile}`);

  // Quality (VP Engineering & Quality).
  const check = (taskId: string, title: string) => api.post("vp", `/tasks/${taskId}/qa-checks`, { title }, "qaCheck");
  const failed = await check(profile, "Profile saves on mobile");
  await api.post("vp", `/qa-checks/${failed}/results`, { outcome: "failed", note: "Avatar is lost after saving on iOS." });
  const passed = await check(onboarding, "Onboarding emails render");
  await api.post("vp", `/qa-checks/${passed}/results`, { outcome: "passed", evidenceUrl: "https://example.test/email-render-report" });
  await check(timeout, "Session expires after 12 hours");
  const defect = (taskId: string, title: string, severity: string, extra: object = {}) =>
    api.post("vp", `/tasks/${taskId}/defects`, { title, severity, reproductionSteps: `Steps to reproduce: ${title}.`, ...extra }, "defect");
  await defect(profile, "Profile save loses avatar", "critical", { qaCheckId: failed });
  const doubleSubmit = await defect(payment, "Payment form double-submits", "high");
  await api.post("employee", `/defects/${doubleSubmit}/status`, { status: "in_progress" });
  const layout = await defect(design, "Legacy browser layout shift", "low");
  await api.post("vp", `/defects/${layout}/status`, { status: "wont_fix", note: "Legacy browsers are out of scope." });
  // The VP has a task in the Field App, so its readiness is a self-QA conflict for the VP; the CEO/CTO sets it.
  await api.post("ceo", `/projects/${mobile}/readiness`, { label: "v2.3", readiness: "ready" });
  await api.post("ceo", `/projects/${portal}/readiness`, { label: "v1.0", readiness: "at_risk", note: "Critical profile defect open." });

  // Meetings (CEO/CTO manages meetings).
  await api.post("ceo", "/meetings", {
    title: "Weekly leadership sync",
    description: "Priorities, risks and approvals.",
    startsAtLocal: when.local(1, "10:00"),
    durationMinutes: 45,
    meetingUrl: "https://example.test/meet/leadership",
    attendeeIds: [ids.cgo, ids.cmo, ids.cfo, ids.vp],
  });
  await api.post("ceo", "/meetings", {
    title: "Client Portal sprint review",
    startsAtLocal: when.local(2, "15:30"),
    durationMinutes: 30,
    projectId: portal,
    attendeeIds: [ids.vp, ids.employee, ids.intern],
  });

  // Growth CRM (CGO).
  const company = (name: string, industry: string) =>
    api.post("cgo", "/growth/companies", { name, industry, websiteUrl: `https://${name.toLowerCase().replaceAll(" ", "-")}.example.test` }, "company");
  const harbor = await company("Harbor Analytics", "Logistics software");
  const lumen = await company("Lumen Health", "Healthcare");
  const atlas = await company("Atlas Outdoor", "Retail");
  const harborContact = await api.post(
    "cgo",
    `/growth/companies/${harbor}/contacts`,
    { fullName: "Dana Whitfield", roleTitle: "Head of Operations", email: "dana@harbor.example.test" },
    "contact",
  );
  const lead = (name: string, companyId: string, source: string, value: number, extra: object = {}) =>
    api.post(
      "cgo",
      "/growth/leads",
      { name, companyId, source, priority: "medium", estimatedValueMinor: value, nextFollowUpOn: when.day(3), ...extra },
      "lead",
    );
  const harborLead = await lead("Harbor fleet dashboard", harbor, "referral", 4_800_000, { primaryContactId: harborContact, priority: "high" });
  await api.post("cgo", `/growth/leads/${harborLead}/stage`, { to: "contacted" });
  await api.post("cgo", `/growth/leads/${harborLead}/stage`, { to: "qualified", note: "Budget confirmed for next quarter." });
  const lumenLead = await lead("Lumen patient portal", lumen, "inbound_email", 3_200_000);
  await api.post("cgo", `/growth/leads/${lumenLead}/stage`, { to: "contacted" });
  await lead("Atlas loyalty app", atlas, "event", 1_500_000);
  const lostLead = await lead("Atlas inventory sync", atlas, "cold_outreach", 900_000);
  await api.post("cgo", `/growth/leads/${lostLead}/stage`, { to: "lost", lostReason: "timing", note: "Revisit after their peak season." });
  await api.post("cgo", "/growth/activities", {
    leadId: harborLead,
    contactId: harborContact,
    kind: "call",
    direction: "outbound",
    outcome: "positive",
    occurredAt: when.iso(-1),
    summary: "Discovery call: wants weekly fleet reports.",
  });
  await api.post("cgo", "/growth/activities", {
    leadId: lumenLead,
    kind: "email",
    direction: "inbound",
    outcome: "replied",
    occurredAt: when.iso(-2),
    summary: "Asked for case studies and pricing range.",
  });

  // More open leads with varied sources, so the source split is not uniform.
  const referralA = await lead("Harbor driver mobile app", harbor, "referral", 1_800_000);
  await api.post("cgo", `/growth/leads/${referralA}/stage`, { to: "contacted" });
  await lead("Lumen appointment reminders", lumen, "referral", 1_100_000);
  const linkedinLead = await lead("Atlas store analytics", atlas, "linkedin", 2_000_000);
  await api.post("cgo", `/growth/leads/${linkedinLead}/stage`, { to: "contacted" });
  await lead("Lumen staff scheduling", lumen, "website", 750_000);
  await lead("Harbor customs paperwork", harbor, "inbound_email", 600_000);

  // Proposals: the CGO drafts, submits, sends and records acceptance; the CEO/CTO approves.
  const proposal = (leadId: string, amountMinor: number, summary: string) =>
    api.post(
      "cgo",
      `/growth/leads/${leadId}/proposal/versions`,
      { documentUrl: "https://example.test/proposals/draft", amountMinor, validUntil: when.day(30), summary, expectedVersionNo: null },
      "proposal",
    );
  const sentProposal = await proposal(harborLead, 4_800_000, "Fleet dashboard: discovery, build and three months of support.");
  await api.post("cgo", `/growth/proposals/${sentProposal}/submit`, { versionNo: 1 });
  await api.post("ceo", `/growth/proposals/${sentProposal}/approve`, { versionNo: 1, note: "Pricing within guidelines." });
  await api.post("cgo", `/growth/proposals/${sentProposal}/sent`, { versionNo: 1 });
  const pendingProposal = await proposal(lumenLead, 3_200_000, "Patient portal pilot for two clinics.");
  await api.post("cgo", `/growth/proposals/${pendingProposal}/submit`, { versionNo: 1 });
  const wonLead = await lead("Northwind data migration", harbor, "partner", 2_400_000);
  await api.post("cgo", `/growth/leads/${wonLead}/stage`, { to: "contacted" });
  await api.post("cgo", `/growth/leads/${wonLead}/stage`, { to: "qualified" });
  const wonProposal = await proposal(wonLead, 2_400_000, "Legacy data migration with validation reports.");
  await api.post("cgo", `/growth/proposals/${wonProposal}/submit`, { versionNo: 1 });
  await api.post("ceo", `/growth/proposals/${wonProposal}/approve`, { versionNo: 1 });
  await api.post("cgo", `/growth/proposals/${wonProposal}/sent`, { versionNo: 1 });
  // An email-confirmed acceptance is accepted directly; only verbal or late acceptances need CEO confirmation.
  await api.post("cgo", `/growth/proposals/${wonProposal}/acceptance`, {
    versionNo: 1,
    method: "email_confirmation",
    acceptedOn: when.day(0),
    evidenceUrl: "https://example.test/proposals/acceptance-email",
  });
  await api.post("cgo", `/growth/leads/${wonLead}/won`, { versionNo: 1 });

  // Marketing (CMO).
  const campaign = await api.post(
    "cmo",
    "/marketing/campaigns",
    { name: "Spring product launch", objective: "Announce the Client Portal.", startsOn: when.day(0), endsOn: when.day(30) },
    "campaign",
  );
  await api.post("cmo", `/marketing/campaigns/${campaign}/status`, { to: "planned" });
  await api.post("cmo", `/marketing/campaigns/${campaign}/status`, { to: "active" });
  await api.post("cmo", "/marketing/campaigns", { name: "Customer stories series", objective: "Monthly customer spotlights." });
  const content = (title: string, channel: string, plannedFor: number) =>
    api.post("cmo", "/marketing/content", { title, channel, campaignId: campaign, plannedFor: when.day(plannedFor), brief: `${title}.` }, "content");
  const teaser = await content("Launch teaser video", "youtube", 2);
  await api.post("cmo", `/marketing/content/${teaser}/status`, { to: "planned" });
  const post = await content("Launch announcement post", "linkedin", 1);
  await api.post("cmo", `/marketing/content/${post}/status`, { to: "planned" });
  await api.post("cmo", `/marketing/content/${post}/status`, { to: "in_review" });
  await content("Behind-the-scenes reel", "instagram", 5);
  // Published today with reach figures the CMO recorded (fictional), so reach by channel has data.
  const published = async (title: string, channel: string, outcome: { reach: number; engagements: number; clicks: number }) => {
    const id = await content(title, channel, 0);
    await api.post("cmo", `/marketing/content/${id}/status`, { to: "planned" });
    await api.post("cmo", `/marketing/content/${id}/status`, { to: "in_review" });
    await api.post("cmo", `/marketing/content/${id}/status`, { to: "published", proofUrl: `https://example.test/posts/${id}` });
    await api.post("cmo", `/marketing/content/${id}/outcome`, outcome);
  };
  await published("Client Portal sneak peek", "linkedin", { reach: 8_400, engagements: 610, clicks: 230 });
  await published("Founder Q&A clip", "linkedin", { reach: 5_200, engagements: 340, clicks: 120 });
  await published("Portal walkthrough video", "youtube", { reach: 3_100, engagements: 280, clicks: 95 });
  await published("Team photo carousel", "instagram", { reach: 2_300, engagements: 410, clicks: 40 });

  // Engineering operations (VP Engineering & Quality).
  const incident = await api.post(
    "vp",
    "/operations/incidents",
    { title: "Elevated sign-in latency", severity: "sev2", ownerId: ids.vp, summary: "p95 sign-in time above 2s.", startedAt: when.iso(0, -3) },
    "incident",
  );
  await api.post("vp", `/operations/incidents/${incident}/status`, { to: "investigating", note: "Database connection pool saturated." });
  const resolved = await api.post(
    "vp",
    "/operations/incidents",
    { title: "Report export timeout", severity: "sev3", ownerId: ids.employee, startedAt: when.iso(-4) },
    "incident",
  );
  await api.post("vp", `/operations/incidents/${resolved}/status`, { to: "resolved", resolution: "Moved exports to a background job." });
  const release = await api.post(
    "vp",
    "/operations/releases",
    { name: "Field App 2.3", versionLabel: "2.3.0", environment: "staging", plannedFor: when.day(4), notes: "Offline mode and sync fixes." },
    "release",
  );
  await api.post("vp", `/operations/releases/${release}/checklist`, { label: "Regression suite green" });
  await api.post("vp", `/operations/releases/${release}/checklist`, { label: "Release notes approved" });
  await api.post("vp", "/operations/automations", {
    name: "Nightly invoice export",
    purpose: "Exports the day's invoices for finance.",
    trigger: "Every night at 02:00",
  });
  await api.post(
    "vp",
    "/operations/incidents",
    { title: "Delayed webhook deliveries", severity: "sev3", ownerId: ids.employee, summary: "Partner webhooks arriving up to 10 minutes late.", startedAt: when.iso(0, -1) },
    "incident",
  );
  // Live automation (CEO/CTO approved go-live) whose recent runs include a failure: degraded health.
  const digest = await api.post(
    "vp",
    "/operations/automations",
    { name: "Weekly lead digest", purpose: "Emails the CGO a summary of new and stale leads.", trigger: "Mondays at 08:00" },
    "automation",
  );
  await api.post("vp", `/operations/automations/${digest}/status`, { to: "testing" });
  await api.post("vp", `/operations/automations/${digest}/status`, { to: "awaiting_approval" });
  await api.post("ceo", `/operations/automations/${digest}/status`, { to: "live", note: "Approved after a clean test week." });
  const run = (id: string, daysAgo: number, outcome: "succeeded" | "failed") =>
    api.post("vp", `/operations/automations/${id}/runs`, {
      startedAt: when.iso(-daysAgo),
      finishedAt: when.iso(-daysAgo, 0.05),
      outcome,
      ...(outcome === "failed" ? { errorSummary: "Mail relay timed out." } : {}),
    });
  await run(digest, 3, "failed");
  await run(digest, 1, "succeeded");
  // Automation still in testing with a clean run: healthy.
  const notes = await api.post(
    "vp",
    "/operations/automations",
    { name: "Release notes draft", purpose: "Drafts release notes from completed tasks.", trigger: "When a release is created" },
    "automation",
  );
  await api.post("vp", `/operations/automations/${notes}/status`, { to: "testing" });
  await run(notes, 1, "succeeded");

  // A pending approval for the CEO/CTO's queue.
  await api.post("vp", "/approvals", {
    type: "user.role_change",
    targetUserId: ids.intern,
    payload: { newRole: "employee" },
    reason: "Internship complete; joining the engineering team.",
  });
}

export async function seedDemo(env: SeedEnv): Promise<void> {
  const migrator = createDatabase(env.DATABASE_URL_MIGRATOR, { applicationName: "crm-demo-seed-migrator" });
  const appDb = createDatabase(env.DATABASE_URL_APP, { applicationName: "crm-demo-seed-app" });
  let app: FastifyInstance | undefined;
  try {
    await assertSafeTarget(migrator.db, appDb.db, env.DEMO_SEED_CONFIRM);

    const ceo = DEMO_ACCOUNTS.find((account) => account.role === "ceo_cto");
    if (!ceo) throw new SeedError("No CEO/CTO demo account is defined");
    const ids: Partial<Record<Key, string>> = {};
    ids.ceo = (
      await bootstrapSuperAdmin(migrator.db, {
        email: ceo.email,
        name: ceo.name,
        password: env.DEMO_ACCOUNT_PASSWORD,
        passwordConfirmation: env.DEMO_ACCOUNT_PASSWORD,
        confirmation: BOOTSTRAP_CONFIRMATION,
      })
    ).userId;
    const passwordHash = await hashPassword(env.DEMO_ACCOUNT_PASSWORD);
    for (const account of DEMO_ACCOUNTS) {
      const key = KEY_BY_ROLE[account.role];
      if (!key) throw new SeedError("A demo account has a role the seed does not cover");
      if (key !== "ceo") ids[key] = await insertUser(migrator.db, account.email, account.name, account.role, passwordHash);
    }
    const complete = ids as Record<Key, string>;

    // Demo mode stays off here so the seed can write; the public API runs with DEMO_MODE=true.
    app = await buildApp({
      db: appDb.db,
      env: { APP_ORIGIN: SEED_ORIGIN, NODE_ENV: "production", LOG_LEVEL: "silent", ORG_TIMEZONE: env.ORG_TIMEZONE, DEMO_MODE: false },
    });
    const api = client(app);
    for (const account of DEMO_ACCOUNTS) {
      const key = KEY_BY_ROLE[account.role];
      if (key) await api.login(key, account.email, env.DEMO_ACCOUNT_PASSWORD);
    }
    await seedContent(api, complete, clock(env.ORG_TIMEZONE), migrator.db);
  } finally {
    await app?.close();
    await appDb.pool.end();
    await migrator.pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  Promise.resolve()
    .then(() => seedDemo(loadSeedEnv(process.env)))
    .then(() => {
      console.log("Demo database seeded.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof SeedError ? error.message : "Demo seed failed");
      process.exitCode = 1;
    });
}
