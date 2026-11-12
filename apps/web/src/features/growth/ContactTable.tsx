import type { Contact } from "@crm/contracts/growth";
import type { Role } from "@crm/permissions";
import { DataTable, type Column } from "../../components/DataTable";
import { contactActionsFor } from "../../lib/growth-actions";
import { isSafeProofUrl } from "../../lib/task-actions";
import { ArchiveDialog } from "./ArchiveDialog";
import { ContactFormDrawer } from "./ContactFormDrawer";
import { DoNotContactDialog } from "./DoNotContactDialog";
import styles from "./Growth.module.css";
import { ArchivedBadge, DoNotContactBadge, OwnerFlag } from "./OwnerFlag";

const SafeLink = ({ href, label }: { href: string; label: string }) =>
  isSafeProofUrl(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );

/** Contacts with their methods and the actions this viewer may take on each. */
export function ContactTable({ contacts, role }: { contacts: Contact[]; role: Role }) {
  const columns: Column<Contact>[] = [
    {
      key: "name",
      header: "Contact",
      render: (contact) => (
        <span className={styles.actions}>
          <span className={styles.titleLink}>{contact.fullName}</span>
          {contact.doNotContact ? <DoNotContactBadge /> : null}
          {contact.archivedAt ? <ArchivedBadge /> : null}
          <OwnerFlag flagged={contact.ownerFlagged} />
        </span>
      ),
    },
    { key: "role", header: "Role", render: (contact) => <span className={styles.muted}>{contact.roleTitle ?? "—"}</span> },
    {
      key: "methods",
      header: "Reach",
      render: (contact) => (
        <span className={styles.methods}>
          {contact.email ? <span>{contact.email}</span> : null}
          {contact.phone ? <span>{contact.phone}</span> : null}
          {contact.linkedinUrl ? <SafeLink href={contact.linkedinUrl} label="LinkedIn" /> : null}
          {contact.websiteUrl ? <SafeLink href={contact.websiteUrl} label="Website" /> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (contact) => {
        const actions = contactActionsFor({ role, contact });
        if (actions.readOnly || !actions.canEdit) return <span className={styles.subtle}>{actions.readOnly ? "Read-only" : "—"}</span>;
        return (
          <span className={styles.actions}>
            <ContactFormDrawer companyId={contact.companyId} contact={contact} />
            {actions.canToggleDoNotContact ? (
              <DoNotContactDialog contactId={contact.id} contactName={contact.fullName} current={contact.doNotContact} />
            ) : null}
            {actions.canArchive ? <ArchiveDialog kind="contact" id={contact.id} name={contact.fullName} /> : null}
          </span>
        );
      },
    },
  ];
  return <DataTable caption="Contacts" columns={columns} rows={contacts} rowKey={(contact) => contact.id} />;
}
