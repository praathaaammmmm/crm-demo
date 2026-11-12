import { companyPageSchema } from "@crm/contracts/growth";
import { leadPageSchema } from "@crm/contracts/growth-leads";
import { proposalPageSchema } from "@crm/contracts/growth-proposals";
import { growthOverviewSchema } from "@crm/contracts/growth-reports";
import Link from "next/link";
import { CapNotice } from "../../../components/CapNotice";
import { ErrorNotice } from "../../../components/ErrorNotice";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { DateRangeFilter } from "../../../features/growth/DateRangeFilter";
import { GrowthOverviewBody } from "../../../features/growth/GrowthOverview";
import { readReportRange } from "../../../lib/growth-report-view";
import { canSeeGrowth } from "../../../lib/navigation";
import { loadPeople } from "../../../lib/people";
import type { SearchParams } from "../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

const TITLE = "Growth overview";
const PREVIEW_ROWS = "10";

function InvalidRange({ message }: { message: string }) {
  return (
    <>
      <PageToolbar icon="gauge" title={TITLE} />
      <PageContent>
        <DateRangeFilter range={null} today={null} />
        <ErrorNotice message={message} />
        <p>
          <Link href="/growth">Show the last 90 days</Link>
        </p>
      </PageContent>
    </>
  );
}

/** CGO operational dashboard and CEO/CTO read-only overview (growth:read_all; ADR 0010). */
export default async function GrowthOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canSeeGrowth(user.role)) {
    return (
      <>
        <PageToolbar icon="gauge" title={TITLE} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const requested = readReportRange(await searchParams);
  if (!requested.ok) return <InvalidRange message={requested.message} />;
  const query: Record<string, string> = {};
  if (requested.query.from !== undefined) query["from"] = requested.query.from;
  if (requested.query.to !== undefined) query["to"] = requested.query.to;

  const [result, overdue, stale, companies, people, proposalList] = await Promise.all([
    serverGet("/growth/reports/overview", growthOverviewSchema, query),
    serverGet("/growth/leads", leadPageSchema, { overdue: "true", limit: PREVIEW_ROWS }),
    serverGet("/growth/leads", leadPageSchema, { stale: "true", limit: PREVIEW_ROWS }),
    collectPages("/growth/companies", companyPageSchema),
    loadPeople(user),
    collectPages("/growth/proposals", proposalPageSchema, {}, 2),
  ]);
  // The API's range rules (future dates, more than 366 days) come back as a safe validation message.
  if (!result.ok && result.failure.kind === "invalid") return <InvalidRange message={result.failure.message} />;
  const data = dataOrForbidden(result);
  const overdueLeads = dataOrForbidden(overdue);
  const staleLeads = dataOrForbidden(stale);
  if (data === "forbidden" || overdueLeads === "forbidden" || staleLeads === "forbidden") {
    return (
      <>
        <PageToolbar icon="gauge" title={TITLE} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const companyNames = new Map(companies.ok ? companies.data.items.map((company) => [company.id, company.name] as const) : []);
  const companyOf = (id: string | null) => (id === null ? "No company" : (companyNames.get(id) ?? "Archived company"));

  return (
    <>
      <PageToolbar icon="gauge" title={TITLE} />
      <PageContent>
        <DateRangeFilter range={data.range} today={data.today} />
        <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
        {data.pipeline.openCount === 0 && data.byOwner.length === 0 ? (
          <p>No leads yet. Leads appear here as the CGO adds them.</p>
        ) : null}
        <GrowthOverviewBody data={data} proposals={proposalList.ok ? proposalList.data.items : null} overdue={overdueLeads.items} stale={staleLeads.items} nameOf={people.nameOf} companyOf={companyOf} />
      </PageContent>
    </>
  );
}
