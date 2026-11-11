import { approvalPageSchema, approvalStatusSchema } from "@crm/contracts/approvals";
import { directoryPageSchema } from "@crm/contracts/organization";
import Link from "next/link";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { FilterBar } from "../../../components/FilterBar";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { PillLink } from "../../../components/Pill";
import { ApprovalList } from "../../../features/approvals/ApprovalList";
import { canDecideApprovals, canSeeApprovals } from "../../../lib/navigation";
import { isUuid, readParam, type SearchParams } from "../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

const FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
] as const;

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const viewerCanDecide = canDecideApprovals(user.role);
  const title = viewerCanDecide ? "Approvals" : "My requests";
  if (!canSeeApprovals(user.role)) {
    return (
      <>
        <PageToolbar icon="shield" title="Approvals" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const params = await searchParams;
  const requested = readParam(params, "status") ?? "pending";
  const status = requested === "all" ? undefined : (approvalStatusSchema.safeParse(requested).data ?? "pending");
  const filter = status ?? "all";
  const cursorParam = readParam(params, "cursor");
  const cursor = isUuid(cursorParam) ? cursorParam : undefined;

  const query: Record<string, string> = {};
  if (status !== undefined) query["status"] = status;
  if (cursor !== undefined) query["cursor"] = cursor;

  const [approvalsResult, directoryResult] = await Promise.all([
    serverGet("/approvals", approvalPageSchema, query),
    collectPages("/users", directoryPageSchema),
  ]);
  const page = dataOrForbidden(approvalsResult);

  // Names are a convenience; the inbox still works if the directory cannot be read.
  const names = new Map(directoryResult.ok ? directoryResult.data.items.map((u) => [u.id, u.name] as const) : []);
  const namesTruncated = directoryResult.ok && directoryResult.data.truncated;

  return (
    <>
      <PageToolbar
        icon="shield"
        title={title}
        controls={
          <FilterBar clearHref={null}>
            {FILTERS.map((f) => (
              <PillLink key={f.value} href={`/approvals?status=${f.value}`} selected={f.value === filter}>
                {f.label}
              </PillLink>
            ))}
          </FilterBar>
        }
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={namesTruncated} message={TASK_CAP_NOTICE.names} />
            {page.items.length === 0 ? (
              <EmptyState title="No requests" />
            ) : (
              <ApprovalList approvals={page.items} names={names} viewerId={user.id} viewerCanDecide={viewerCanDecide} />
            )}
            {page.nextCursor === null ? null : (
              <p style={{ marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>
                <Link href={`/approvals?status=${filter}&cursor=${page.nextCursor}`}>Next page</Link>
              </p>
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
