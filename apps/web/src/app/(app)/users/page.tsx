import { directoryPageSchema } from "@crm/contracts/organization";
import Link from "next/link";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { UserTable } from "../../../features/organization/UserTable";
import { canReadDirectory } from "../../../lib/navigation";
import { isUuid, readParam, type SearchParams } from "../../../lib/search-params";
import { dataOrForbidden, serverGet } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const toolbar = <PageToolbar icon="users" title="Users" />;
  if (!canReadDirectory(user.role)) {
    return (
      <>
        {toolbar}
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const cursor = readParam(await searchParams, "cursor");
  const validCursor = isUuid(cursor) ? cursor : undefined;
  const page = dataOrForbidden(
    await serverGet("/users", directoryPageSchema, validCursor === undefined ? {} : { cursor: validCursor }),
  );

  return (
    <>
      {toolbar}
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            {page.items.length === 0 ? <EmptyState title="No users yet" /> : <UserTable users={page.items} />}
            <p style={{ marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>
              {validCursor === undefined ? null : <Link href="/users">First page</Link>}
              {validCursor !== undefined && page.nextCursor !== null ? " · " : null}
              {page.nextCursor === null ? null : <Link href={`/users?cursor=${page.nextCursor}`}>Next page</Link>}
            </p>
          </>
        )}
      </PageContent>
    </>
  );
}
