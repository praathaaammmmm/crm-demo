import {
  hasContactMethod,
  type CompanyListQuery,
  type ContactListQuery,
  type CreateCompanyRequest,
  type CreateContactRequest,
  type UpdateCompanyRequest,
  type UpdateContactRequest,
} from "@crm/contracts/growth";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { AppError, errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { changedFlags, GROWTH_AUDIT } from "./growth.audit.js";
import * as policy from "./growth.policy.js";
import * as repo from "./growth.repository.js";
import type { CompanyRow, ContactRow } from "./growth.repository.js";

type User = AuthSession["user"];

export interface GrowthDeps {
  db: Database;
}

/** The database code of a refused write, looking through Drizzle's wrapper. */
export function pgCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = current.cause;
  }
  return null;
}

/**
 * Runs a write. The service checks archive state, duplicates and ownership first; the database guards
 * are the backstop, and their refusals (check or unique violations) become a safe 409.
 */
export async function guarded<T>(db: Database, work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = pgCode(error);
    if (code === "23514" || code === "23505") throw errors.conflict("This change is not allowed in the record's current state");
    throw error;
  }
}

export const page = <T extends { id: string }>(rows: T[], limit: number) => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
};

export async function assertOwnerIsActiveCgo(db: Database, user: User): Promise<void> {
  if (!(await repo.isActiveCgo(db, user.id))) throw errors.conflict("Growth records can only be owned by an active CGO");
}

const assertCompanyEditable = (company: CompanyRow) => {
  if (company.archivedAt !== null) throw errors.conflict("An archived company is read-only");
};

const assertContactEditable = (contact: ContactRow) => {
  if (contact.companyArchived) throw errors.conflict("Contacts of an archived company are read-only");
  if (contact.archivedAt !== null) throw errors.conflict("An archived contact is read-only");
};

async function reloadCompany(tx: Tx, id: string): Promise<CompanyRow> {
  const company = await repo.findCompany(tx, id);
  if (!company) throw new Error("Company not found after change");
  return company;
}

async function reloadContact(tx: Tx, id: string): Promise<ContactRow> {
  const contact = await repo.findContact(tx, id);
  if (!contact) throw new Error("Contact not found after change");
  return contact;
}

// Companies

export async function listCompanies(deps: GrowthDeps, user: User, query: CompanyListQuery) {
  policy.assertCanRead(user);
  const rows = await repo.listCompanies(deps.db, { archived: query.archived === "true", cursor: query.cursor, limit: query.limit });
  return page(rows, query.limit);
}

export async function getCompany(deps: GrowthDeps, user: User, id: string): Promise<CompanyRow> {
  policy.assertCanRead(user);
  const company = await repo.findCompany(deps.db, id);
  if (!company) throw errors.notFound();
  return company;
}

/** CGO only; the caller becomes the owner. */
export async function createCompany(deps: GrowthDeps, ctx: Ctx, user: User, input: CreateCompanyRequest): Promise<CompanyRow> {
  policy.assertCanManage(user);
  await assertOwnerIsActiveCgo(deps.db, user);
  if (await repo.companyNameTaken(deps.db, input.name, null)) throw errors.conflict("A company with this name already exists");
  return guarded(deps.db, async (tx) => {
    const id = await repo.insertCompany(tx, {
      name: input.name,
      websiteUrl: input.websiteUrl ?? null,
      industry: input.industry ?? null,
      notes: input.notes ?? null,
      ownerId: user.id,
      createdBy: user.id,
    });
    await recordAudit(tx, ctx, { action: GROWTH_AUDIT.companyCreated, entityType: "growth_company", entityId: id, after: { archived: false } });
    return reloadCompany(tx, id);
  });
}

export async function updateCompany(deps: GrowthDeps, ctx: Ctx, user: User, id: string, input: UpdateCompanyRequest): Promise<CompanyRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const before = await repo.lockCompany(tx, id);
    if (!before) throw errors.notFound();
    assertCompanyEditable(before);
    if (input.name !== undefined && (await repo.companyNameTaken(tx, input.name, id))) {
      throw errors.conflict("A company with this name already exists");
    }
    await repo.updateCompany(tx, id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl }),
      ...(input.industry === undefined ? {} : { industry: input.industry }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    const after = await reloadCompany(tx, id);
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.companyUpdated,
      entityType: "growth_company",
      entityId: id,
      after: changedFlags(before, after, ["name", "websiteUrl", "industry", "notes"]),
    });
    return after;
  });
}

export async function archiveCompany(deps: GrowthDeps, ctx: Ctx, user: User, id: string): Promise<CompanyRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const before = await repo.lockCompany(tx, id);
    if (!before) throw errors.notFound();
    assertCompanyEditable(before);
    await repo.archiveCompany(tx, id);
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.companyArchived,
      entityType: "growth_company",
      entityId: id,
      before: { archived: false },
      after: { archived: true },
    });
    return reloadCompany(tx, id);
  });
}

// Contacts

export async function listContacts(deps: GrowthDeps, user: User, companyId: string, query: ContactListQuery) {
  policy.assertCanReadContacts(user);
  if (!(await repo.findCompany(deps.db, companyId))) throw errors.notFound();
  const rows = await repo.listContacts(deps.db, { companyId, archived: query.archived === "true", cursor: query.cursor, limit: query.limit });
  return page(rows, query.limit);
}

export async function getContact(deps: GrowthDeps, user: User, id: string): Promise<ContactRow> {
  policy.assertCanReadContacts(user);
  const contact = await repo.findContact(deps.db, id);
  if (!contact) throw errors.notFound();
  return contact;
}

/** CGO only. Refused (409) when the company is archived or the email is already used there. */
export async function createContact(
  deps: GrowthDeps,
  ctx: Ctx,
  user: User,
  companyId: string,
  input: CreateContactRequest,
): Promise<ContactRow> {
  policy.assertCanManage(user);
  await assertOwnerIsActiveCgo(deps.db, user);
  return guarded(deps.db, async (tx) => {
    const company = await repo.lockCompany(tx, companyId);
    if (!company) throw errors.notFound();
    if (company.archivedAt !== null) throw errors.conflict("Contacts cannot be added to an archived company");
    if (input.email && (await repo.contactEmailTaken(tx, companyId, input.email, null))) {
      throw errors.conflict("A contact with this email already exists at this company");
    }
    const id = await repo.insertContact(tx, {
      companyId,
      fullName: input.fullName,
      roleTitle: input.roleTitle ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      doNotContact: input.doNotContact ?? false,
      ownerId: user.id,
    });
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.contactCreated,
      entityType: "growth_contact",
      entityId: id,
      after: { companyId, doNotContact: input.doNotContact ?? false, archived: false },
    });
    return reloadContact(tx, id);
  });
}

/** CGO only. The at-least-one-contact-method rule is checked against the edited result. */
export async function updateContact(deps: GrowthDeps, ctx: Ctx, user: User, id: string, input: UpdateContactRequest): Promise<ContactRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const before = await repo.lockContact(tx, id);
    if (!before) throw errors.notFound();
    assertContactEditable(before);
    const merged = {
      email: input.email === undefined ? before.email : input.email,
      phone: input.phone === undefined ? before.phone : input.phone,
      linkedinUrl: input.linkedinUrl === undefined ? before.linkedinUrl : input.linkedinUrl,
      websiteUrl: input.websiteUrl === undefined ? before.websiteUrl : input.websiteUrl,
    };
    if (!hasContactMethod(merged)) throw errors.validation("Add an email, phone, LinkedIn or website");
    if (input.email && (await repo.contactEmailTaken(tx, before.companyId, input.email, id))) {
      throw errors.conflict("A contact with this email already exists at this company");
    }
    await repo.updateContact(tx, id, {
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.roleTitle === undefined ? {} : { roleTitle: input.roleTitle }),
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.linkedinUrl === undefined ? {} : { linkedinUrl: input.linkedinUrl }),
      ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl }),
      ...(input.doNotContact === undefined ? {} : { doNotContact: input.doNotContact }),
    });
    const after = await reloadContact(tx, id);
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.contactUpdated,
      entityType: "growth_contact",
      entityId: id,
      before: { doNotContact: before.doNotContact },
      after: {
        companyId: after.companyId,
        doNotContact: after.doNotContact,
        ...changedFlags(before, after, ["fullName", "roleTitle", "email", "phone", "linkedinUrl", "websiteUrl"]),
      },
    });
    return after;
  });
}

export async function archiveContact(deps: GrowthDeps, ctx: Ctx, user: User, id: string): Promise<ContactRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const before = await repo.lockContact(tx, id);
    if (!before) throw errors.notFound();
    assertContactEditable(before);
    await repo.archiveContact(tx, id);
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.contactArchived,
      entityType: "growth_contact",
      entityId: id,
      before: { archived: false },
      after: { companyId: before.companyId, archived: true },
    });
    return reloadContact(tx, id);
  });
}
