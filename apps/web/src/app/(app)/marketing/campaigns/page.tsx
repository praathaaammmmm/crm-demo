import { campaignPageSchema, campaignStatusSchema, CAMPAIGN_STATUSES, type Campaign } from "@crm/contracts/marketing";
import Link from "next/link";
import { ActionForm } from "../../../../components/ActionForm";
import { CapNotice } from "../../../../components/CapNotice";
import { DataTable } from "../../../../components/DataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { FilterBar } from "../../../../components/FilterBar";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { Pill, PillLink } from "../../../../components/Pill";
import { CAMPAIGN_STATUS_LABELS } from "../../../../lib/marketing-view";
import { canManageMarketing, canSeeMarketing } from "../../../../lib/navigation";
import { hrefWith, readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const status = campaignStatusSchema.safeParse(readParam(await searchParams, "status"));
  const page = canSeeMarketing(user.role)
    ? dataOrForbidden(await collectPages("/marketing/campaigns", campaignPageSchema, status.success ? { status: status.data } : {}))
    : "forbidden";
  const manager = canManageMarketing(user.role);

  return (
    <>
      <PageToolbar
        icon="folder"
        title="Campaigns"
        controls={
          page === "forbidden" ? undefined : (
            <FilterBar clearHref={status.success ? "/marketing/campaigns" : null}>
              {CAMPAIGN_STATUSES.map((value) => (
                <PillLink key={value} href={hrefWith("/marketing/campaigns", { status: value })} selected={status.success && status.data === value}>
                  {CAMPAIGN_STATUS_LABELS[value]}
                </PillLink>
              ))}
            </FilterBar>
          )
        }
        primaryAction={
          manager ? (
            <ActionForm
              label="New campaign"
              title="New campaign"
              confirm="Create campaign"
              variant="primary"
              path="/marketing/campaigns"
              redirect={{ key: "campaign", prefix: "/marketing/campaigns/" }}
              fields={[
                { name: "name", label: "Name", kind: "text", required: true, maxLength: 200 },
                { name: "objective", label: "Objective", kind: "textarea", maxLength: 1000 },
                { name: "startsOn", label: "Starts on", kind: "date" },
                { name: "endsOn", label: "Ends on", kind: "date" },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message="Showing the first 250 campaigns." />
            {page.items.length === 0 ? (
              <EmptyState title="No campaigns yet">{manager ? "Create a campaign to group planned content." : null}</EmptyState>
            ) : (
              <DataTable<Campaign>
                caption="Campaigns"
                rowKey={(row) => row.id}
                rows={page.items}
                columns={[
                  { key: "name", header: "Campaign", render: (row) => <Link href={`/marketing/campaigns/${row.id}`}>{row.name}</Link> },
                  { key: "status", header: "Status", render: (row) => <Pill>{CAMPAIGN_STATUS_LABELS[row.status]}</Pill> },
                  { key: "dates", header: "Dates", render: (row) => `${row.startsOn ?? "—"} → ${row.endsOn ?? "—"}` },
                  { key: "content", header: "Content", render: (row) => String(row.contentCount) },
                ]}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
