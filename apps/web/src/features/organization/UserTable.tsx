import type { DirectoryPage } from "@crm/contracts/organization";
import { DataTable, type Column } from "../../components/DataTable";
import { roleLabel } from "../../lib/navigation";

type DirectoryItem = DirectoryPage["items"][number];

/** The email column appears only when the API included emails (CEO/CTO only). */
export function UserTable({ users }: { users: DirectoryItem[] }) {
  const showEmail = users.some((user) => user.email !== undefined);
  const columns: Column<DirectoryItem>[] = [
    { key: "name", header: "Name", render: (user) => user.name },
    ...(showEmail ? [{ key: "email", header: "Email", render: (user: DirectoryItem) => user.email ?? "" }] : []),
    { key: "role", header: "Role", render: (user) => roleLabel(user.role) },
    { key: "status", header: "Status", render: (user) => (user.status === "active" ? "Active" : "Deactivated") },
  ];
  return <DataTable caption="Users" columns={columns} rows={users} rowKey={(user) => user.id} />;
}
