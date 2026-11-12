import type { DirectoryPage } from "@crm/contracts/organization";
import { Avatar } from "../../components/Avatar";
import { DataTable, type Column } from "../../components/DataTable";
import { Pill } from "../../components/Pill";
import { roleLabel } from "../../lib/navigation";
import { DeactivateUserDialog } from "./DeactivateUserDialog";
import styles from "./Organization.module.css";
import { ResetAccessDialog } from "./ResetAccessDialog";

type DirectoryItem = DirectoryPage["items"][number];

/** The email column appears only when the API included emails (CEO/CTO only). */
export function UserTable({
  users,
  viewer,
}: {
  users: DirectoryItem[];
  viewer?: { id: string; canDeactivate: boolean; canResetAccess: boolean };
}) {
  // Never the viewer's own row and never the CEO/CTO (the sole Super Admin). The API enforces the same rules.
  const other = (user: DirectoryItem) => viewer !== undefined && user.id !== viewer.id && user.role !== "ceo_cto";
  const deactivatable = (user: DirectoryItem) => other(user) && viewer?.canDeactivate === true && user.status === "active";
  const resettable = (user: DirectoryItem) => other(user) && viewer?.canResetAccess === true;
  const showActions = users.some((user) => deactivatable(user) || resettable(user));
  const showEmail = users.some((user) => user.email !== undefined);
  const columns: Column<DirectoryItem>[] = [
    {
      key: "name",
      header: "Name",
      render: (user) => (
        <span className={styles.person}>
          <Avatar name={user.name} size="xs" />
          <span className={styles.personName} aria-hidden="true">
            {user.name}
          </span>
        </span>
      ),
    },
    ...(showEmail
      ? [
          {
            key: "email",
            header: "Email",
            render: (user: DirectoryItem) => <span className={styles.muted}>{user.email ?? ""}</span>,
          },
        ]
      : []),
    {
      key: "role",
      header: "Role",
      render: (user) => <Pill tone={user.role === "ceo_cto" ? "accent" : "neutral"}>{roleLabel(user.role)}</Pill>,
    },
    {
      key: "status",
      header: "Status",
      render: (user) =>
        user.status === "active" ? (
          <Pill tone="success" dot>
            Active
          </Pill>
        ) : (
          <Pill dot>Deactivated</Pill>
        ),
    },
    ...(showActions
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (user: DirectoryItem) =>
              deactivatable(user) || resettable(user) ? (
                <span className={styles.actionsCell}>
                  {resettable(user) ? <ResetAccessDialog userId={user.id} userName={user.name} deactivated={user.status === "deactivated"} /> : null}
                  {deactivatable(user) ? <DeactivateUserDialog userId={user.id} userName={user.name} /> : null}
                </span>
              ) : null,
          },
        ]
      : []),
  ];
  return <DataTable caption="Users" columns={columns} rows={users} rowKey={(user) => user.id} density="compact" />;
}
