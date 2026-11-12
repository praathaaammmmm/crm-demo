/**
 * Phase A: reversible local seed trial. Run with: node tests/demo/seed-trial.ts
 *
 * Creates one crm_demo_test_<32 hex> database from the local test template, checks the seed guard, seeds it
 * with the built seed (DEMO_MODE=false), verifies the fictional data, and always drops the database.
 * Loads .env into this process only. Prints PASS/FAIL lines, counts and booleans, never values.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { connectTo, requireEnv, withDatabase } from "../../apps/api/dist/test/db.js";
import {
  assertDemoTestDatabaseName,
  createDemoTestDatabase,
  dropDemoTestDatabase,
  isolationReport,
  tableCounts,
} from "../../apps/api/dist/test/demo-db.js";
import { preflight, REPO_ROOT } from "./preflight.ts";

const SEED_SCRIPT = path.join(REPO_ROOT, "apps/api/dist/src/demo/seed.js");
export const results: { name: string; ok: boolean; detail?: string }[] = [];

export function check(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

/** Runs the built seed with an explicit environment. Returns exit code and combined output (kept in memory). */
export function runSeed(database: string, overrides: Record<string, string | undefined>): Promise<{ code: number; output: string }> {
  assertDemoTestDatabaseName(database);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    DEMO_MODE: "false",
    DATABASE_URL_MIGRATOR: withDatabase(requireEnv("DATABASE_URL_MIGRATOR"), database),
    DATABASE_URL_APP: withDatabase(requireEnv("DATABASE_URL_APP"), database),
    ORG_TIMEZONE: requireEnv("ORG_TIMEZONE"),
  };
  for (const [key, value] of Object.entries(overrides)) env[key] = value;
  const childEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED_SCRIPT], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, output: output.trim() });
    });
  });
}

const EXPECTED: Record<string, number> = {
  users: 7,
  projects: 3,
  tasks: 10,
  qa_checks: 3,
  qa_results: 2,
  defects: 3,
  release_readiness: 2,
  meetings: 2,
  growth_companies: 3,
  growth_contacts: 1,
  growth_leads: 10,
  growth_activities: 2,
  growth_proposals: 3,
  growth_proposal_versions: 3,
  growth_proposal_acceptances: 1,
  growth_proposal_confirmations: 0,
  marketing_campaigns: 2,
  marketing_content: 7,
  ops_incidents: 3,
  ops_releases: 1,
  ops_release_checklist_items: 2,
  ops_automations: 3,
  ops_automation_runs: 3,
  approval_requests: 1,
};

async function verifySeededData(database: string, password: string, seedOutput: string): Promise<void> {
  const counts = await tableCounts(database);
  for (const [table, expected] of Object.entries(EXPECTED)) {
    check(`count ${table} = ${String(expected)}`, counts[table] === expected, `actual ${String(counts[table])}`);
  }
  check("meeting_attendees >= 7", (counts["meeting_attendees"] ?? 0) >= 7, `actual ${String(counts["meeting_attendees"])}`);
  check("audit_events > 0", (counts["audit_events"] ?? 0) > 0);

  const db = await connectTo(requireEnv("DATABASE_URL_MIGRATOR"), database, "crm-demo-test-verify");
  const one = async <T extends object>(text: string): Promise<T | undefined> => (await db.pool.query<T>(text)).rows[0];
  try {
    const nonExample = await one<{ n: string }>("SELECT count(*)::text AS n FROM users WHERE email NOT LIKE '%@example.test'");
    check("all users are @example.test", nonExample?.n === "0");
    const roles = await one<{ roles: string }>("SELECT string_agg(role::text, ',' ORDER BY role::text) AS roles FROM users");
    check("one account per demo role", roles?.roles === "ceo_cto,cfo,cgo,cmo,employee,intern,vp_engineering_quality", roles?.roles);
    const admins = await one<{ n: string }>("SELECT count(*)::text AS n FROM users WHERE is_super_admin");
    check("exactly one super admin", admins?.n === "1");
    const mustChange = await one<{ n: string }>("SELECT count(*)::text AS n FROM users WHERE must_change_password");
    check("no pending password changes", mustChange?.n === "0");
    const statuses = await one<{ s: string }>("SELECT string_agg(DISTINCT status::text, ',' ORDER BY status::text) AS s FROM tasks");
    check("every task status present", statuses?.s === "blocked,changes_requested,completed,in_progress,in_review,todo", statuses?.s);
    const overdue = await one<{ n: string }>("SELECT count(*)::text AS n FROM tasks WHERE due_date < current_date AND status <> 'completed'");
    check("exactly one overdue task", overdue?.n === "1", `actual ${String(overdue?.n)}`);
    const stages = await one<{ s: string }>("SELECT string_agg(stage::text || '=' || n::text, ',' ORDER BY stage::text) AS s FROM (SELECT stage, count(*) AS n FROM growth_leads GROUP BY stage) g");
    check("lead stages", stages?.s === "contacted=3,lost=1,new=4,qualified=1,won=1", stages?.s);
    const sources = await one<{ s: string }>("SELECT string_agg(source::text || '=' || n::text, ',' ORDER BY source::text) AS s FROM (SELECT source, count(*) AS n FROM growth_leads GROUP BY source) g");
    check("lead sources varied", sources?.s === "cold_outreach=1,event=1,inbound_email=2,linkedin=1,partner=1,referral=3,website=1", sources?.s);
    const published = await one<{ n: string }>("SELECT count(*)::text AS n FROM marketing_content WHERE status = 'published' AND reach > 0");
    check("published content with reach", published?.n === "4", `actual ${String(published?.n)}`);
    const openIncidents = await one<{ s: string }>("SELECT string_agg(severity::text, ',' ORDER BY severity::text) AS s FROM ops_incidents WHERE status <> 'resolved'");
    check("open incidents by severity", openIncidents?.s === "sev2,sev3", openIncidents?.s);
    const automations = await one<{ s: string }>("SELECT string_agg(status::text, ',' ORDER BY status::text) AS s FROM ops_automations");
    check("automation lifecycle states", automations?.s === "draft,live,testing", automations?.s);
    const proposals = await one<{ s: string }>("SELECT string_agg(status::text, ',' ORDER BY status::text) AS s FROM growth_proposals");
    check("proposal statuses", proposals?.s === "pending_approval,sent,won", proposals?.s);
    const pending = await one<{ n: string }>("SELECT count(*)::text AS n FROM approval_requests WHERE status = 'pending'");
    check("one pending approval", pending?.n === "1");
    // Every https link stored by the seed points at example.test.
    const urls = await one<{ n: string }>(`
      SELECT count(*)::text AS n FROM (
        SELECT url FROM task_proofs UNION ALL SELECT document_url FROM growth_proposal_versions
        UNION ALL SELECT website_url FROM growth_companies WHERE website_url IS NOT NULL
        UNION ALL SELECT meeting_url FROM meetings WHERE meeting_url IS NOT NULL
      ) links(url) WHERE url !~ '^https://([a-z0-9-]+\\.)*example\\.test(/|$)'`);
    check("all stored links are example.test", urls?.n === "0", `non-example ${String(urls?.n)}`);
  } finally {
    await db.pool.end();
  }
  check("seed output has no password", !seedOutput.includes(password));
}

async function main(): Promise<number> {
  const pre = await preflight();
  if (!pre.ok) return 1;
  const password = randomBytes(18).toString("base64url");
  let database: string | undefined;
  try {
    database = await createDemoTestDatabase();
    check("created disposable crm_demo_test_<32hex> database", /^crm_demo_test_[0-9a-f]{32}$/.test(database));
    const empty = await tableCounts(database);

    // Guard: mismatched confirmation, missing password. Neither may write anything.
    const mismatch = await runSeed(database, { DEMO_SEED_CONFIRM: `crm_demo_test_${"0".repeat(32)}`, DEMO_ACCOUNT_PASSWORD: password });
    check("guard rejects mismatched confirmation", mismatch.code === 1 && mismatch.output.includes("does not match"));
    const missing = await runSeed(database, { DEMO_SEED_CONFIRM: database, DEMO_ACCOUNT_PASSWORD: undefined });
    check("guard rejects missing password, naming only the variable", missing.code === 1 && missing.output === "Invalid or missing environment variables: DEMO_ACCOUNT_PASSWORD");
    check("rejected runs wrote nothing", JSON.stringify(await tableCounts(database)) === JSON.stringify(empty));

    const seeded = await runSeed(database, { DEMO_SEED_CONFIRM: database, DEMO_ACCOUNT_PASSWORD: password });
    check("seed succeeds", seeded.code === 0 && seeded.output === "Demo database seeded.", seeded.code === 0 ? undefined : seeded.output);
    if (seeded.code === 0) {
      const after = await tableCounts(database);
      const again = await runSeed(database, { DEMO_SEED_CONFIRM: database, DEMO_ACCOUNT_PASSWORD: password });
      check("guard rejects a non-empty target", again.code === 1 && again.output.includes("already has users"));
      check("rejected re-run wrote nothing", JSON.stringify(await tableCounts(database)) === JSON.stringify(after));
      await verifySeededData(database, password, seeded.output);
    }
  } finally {
    if (database) await dropDemoTestDatabase(database);
  }
  const post = await isolationReport();
  console.log(`post: demoDatabases=${String(post.demoDatabases)} demoConnections=${String(post.demoConnections)} template=${String(post.templateExists)} crm=${String(post.crmExists)}`);
  check("no crm_demo_test_* databases remain", post.demoDatabases === 0);
  check("no demo connections remain", post.demoConnections === 0);
  check("template still exists", post.templateExists);
  check("crm row counts unchanged", JSON.stringify(await tableCounts("crm")) === JSON.stringify(pre.crmCounts));
  const failed = results.filter((result) => !result.ok).length;
  console.log(`Phase A: ${String(results.length - failed)}/${String(results.length)} passed`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(`Phase A error: ${error instanceof Error ? error.name : "unknown"}`);
      process.exitCode = 1;
    });
}
