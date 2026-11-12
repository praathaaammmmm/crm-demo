import type { DirectoryPage } from "@crm/contracts/organization";
import { Avatar } from "../../components/Avatar";
import { DataTable, type Column } from "../../components/DataTable";
import { Pill } from "../../components/Pill";
import { roleLabel } from "../../lib/navigation";
import styles from "./Organization.module.css";

type DirectoryItem = DirectoryPage["items"][number];

/** The email column appears only when the API included emails (CEO/CTO only). */
export function UserTable({ users }: { users: DirectoryItem[] }) {
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
  ];
  return <DataTable caption="Users" columns={columns} rows={users} rowKey={(user) => user.id} density="compact" />;
}
