import { directoryPageSchema } from "@crm/contracts/organization";
import Link from "next/link";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { CreateUserDialog } from "../../../features/organization/CreateUserDialog";
import styles from "../../../features/organization/Organization.module.css";
import { UserTable } from "../../../features/organization/UserTable";
import { canCreateUsers, canReadDirectory } from "../../../lib/navigation";
import { isUuid, readParam, type SearchParams } from "../../../lib/search-params";
import { dataOrForbidden, serverGet } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canReadDirectory(user.role)) {
    return (
      <>
        <PageToolbar icon="users" title="Users" />
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

  // A count is shown only when this page holds the whole directory; otherwise it would mislead.
  const total = page !== "forbidden" && validCursor === undefined && page.nextCursor === null ? page.items.length : undefined;
  const toolbar = (
    <PageToolbar
      icon="users"
      title="Users"
      count={total}
      countLabel={total === undefined ? undefined : `${String(total)} ${total === 1 ? "user" : "users"}`}
      primaryAction={page !== "forbidden" && canCreateUsers(user.role) ? <CreateUserDialog /> : undefined}
    />
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
            {validCursor === undefined && page.nextCursor === null ? null : (
              <nav className={styles.pager} aria-label="Users pages">
                <span>{page.items.length} on this page</span>
                <span className={styles.pagerLinks}>
                  {validCursor === undefined ? null : <Link href="/users">First page</Link>}
                  {page.nextCursor === null ? null : <Link href={`/users?cursor=${page.nextCursor}`}>Next page</Link>}
                </span>
              </nav>
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
