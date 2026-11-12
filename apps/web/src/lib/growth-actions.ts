import { can, type Role } from "@crm/permissions";

/** UI visibility only for Growth companies and contacts. The API and database enforce every rule again. */

export interface CompanyActions {
  canEdit: boolean;
  canArchive: boolean;
  canAddContact: boolean;
  readOnly: boolean;
}

export interface ContactActions {
  canEdit: boolean;
  canArchive: boolean;
  canToggleDoNotContact: boolean;
  readOnly: boolean;
}

export const canCreateCompany = (role: Role): boolean => can({ role }, "growth:manage");

export function companyActionsFor(input: { role: Role; company: { archivedAt: string | null } }): CompanyActions {
  const manager = can({ role: input.role }, "growth:manage");
  const readOnly = input.company.archivedAt !== null;
  return { canEdit: manager && !readOnly, canArchive: manager && !readOnly, canAddContact: manager && !readOnly, readOnly };
}

/** A contact is read-only when it is archived or its company is archived. */
export function contactActionsFor(input: { role: Role; contact: { archivedAt: string | null; companyArchived: boolean } }): ContactActions {
  const manager = can({ role: input.role }, "growth:manage");
  const readOnly = input.contact.archivedAt !== null || input.contact.companyArchived;
  const write = manager && !readOnly;
  return { canEdit: write, canArchive: write, canToggleDoNotContact: write, readOnly };
}
