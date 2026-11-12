import { growthCompanies, growthContacts, users } from "@crm/database/schema";
import { and, asc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

/** The owner is no longer an active CGO (O8): flagged until the CEO reassigns. */
// Outer columns are written table-qualified: Drizzle renders single-table column references unqualified,
// which a correlated subquery could bind to an inner table's column of the same name.
const ownerFlagged = sql<boolean>`NOT EXISTS (SELECT 1 FROM users o WHERE o.id = growth_companies.owner_id AND o.status = 'active' AND o.role = 'cgo')`;
const contactOwnerFlagged = sql<boolean>`NOT EXISTS (SELECT 1 FROM users o WHERE o.id = growth_contacts.owner_id AND o.status = 'active' AND o.role = 'cgo')`;

const companyColumns = {
  id: growthCompanies.id,
  name: growthCompanies.name,
  websiteUrl: growthCompanies.websiteUrl,
  industry: growthCompanies.industry,
  notes: growthCompanies.notes,
  ownerId: growthCompanies.ownerId,
  ownerFlagged,
  contactCount: sql<number>`(SELECT count(*)::int FROM growth_contacts c WHERE c.company_id = growth_companies.id AND c.archived_at IS NULL)`,
  createdBy: growthCompanies.createdBy,
  createdAt: growthCompanies.createdAt,
  updatedAt: growthCompanies.updatedAt,
  archivedAt: growthCompanies.archivedAt,
};

const contactColumns = {
  id: growthContacts.id,
  companyId: growthContacts.companyId,
  fullName: growthContacts.fullName,
  roleTitle: growthContacts.roleTitle,
  email: growthContacts.email,
  phone: growthContacts.phone,
  linkedinUrl: growthContacts.linkedinUrl,
  websiteUrl: growthContacts.websiteUrl,
  doNotContact: growthContacts.doNotContact,
  ownerId: growthContacts.ownerId,
  ownerFlagged: contactOwnerFlagged,
  createdAt: growthContacts.createdAt,
  updatedAt: growthContacts.updatedAt,
  archivedAt: growthContacts.archivedAt,
  companyArchived: sql<boolean>`${growthCompanies.archivedAt} IS NOT NULL`,
};

export type CompanyRow = NonNullable<Awaited<ReturnType<typeof findCompany>>>;
export type ContactRow = NonNullable<Awaited<ReturnType<typeof findContact>>>;

export async function findCompany(db: Executor, id: string) {
  const rows = await db.select(companyColumns).from(growthCompanies).where(eq(growthCompanies.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks only the company row until the transaction ends. */
export async function lockCompany(tx: Tx, id: string) {
  const rows = await tx.select(companyColumns).from(growthCompanies).where(eq(growthCompanies.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

/** Ordered by name then id, with keyset paging on (lower(name), id). */
export function listCompanies(db: Executor, filter: { archived: boolean; cursor: string | undefined; limit: number }) {
  const conditions: SQL[] = [filter.archived ? isNotNull(growthCompanies.archivedAt) : isNull(growthCompanies.archivedAt)];
  if (filter.cursor !== undefined) {
    conditions.push(
      sql`(lower(${growthCompanies.name}), ${growthCompanies.id}) > (SELECT lower(name), id FROM growth_companies WHERE id = ${filter.cursor})`,
    );
  }
  return db
    .select(companyColumns)
    .from(growthCompanies)
    .where(and(...conditions))
    .orderBy(sql`lower(${growthCompanies.name})`, asc(growthCompanies.id))
    .limit(filter.limit + 1);
}

/** True when another active company already uses the normalised name (case-insensitive). */
export async function companyNameTaken(db: Executor, name: string, exceptId: string | null): Promise<boolean> {
  const rows = await db
    .select({ id: growthCompanies.id })
    .from(growthCompanies)
    .where(
      and(
        sql`lower(${growthCompanies.name}) = lower(${name})`,
        isNull(growthCompanies.archivedAt),
        exceptId === null ? undefined : sql`${growthCompanies.id} <> ${exceptId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function findContact(db: Executor, id: string) {
  const rows = await db
    .select(contactColumns)
    .from(growthContacts)
    .innerJoin(growthCompanies, eq(growthCompanies.id, growthContacts.companyId))
    .where(eq(growthContacts.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Locks only the contact row until the transaction ends. */
export async function lockContact(tx: Tx, id: string) {
  const rows = await tx
    .select(contactColumns)
    .from(growthContacts)
    .innerJoin(growthCompanies, eq(growthCompanies.id, growthContacts.companyId))
    .where(eq(growthContacts.id, id))
    .limit(1)
    .for("update", { of: growthContacts });
  return rows[0] ?? null;
}

export function listContacts(db: Executor, filter: { companyId: string; archived: boolean; cursor: string | undefined; limit: number }) {
  const conditions: SQL[] = [
    eq(growthContacts.companyId, filter.companyId),
    filter.archived ? isNotNull(growthContacts.archivedAt) : isNull(growthContacts.archivedAt),
  ];
  if (filter.cursor !== undefined) {
    conditions.push(
      sql`(lower(${growthContacts.fullName}), ${growthContacts.id}) > (SELECT lower(full_name), id FROM growth_contacts WHERE id = ${filter.cursor})`,
    );
  }
  return db
    .select(contactColumns)
    .from(growthContacts)
    .innerJoin(growthCompanies, eq(growthCompanies.id, growthContacts.companyId))
    .where(and(...conditions))
    .orderBy(sql`lower(${growthContacts.fullName})`, asc(growthContacts.id))
    .limit(filter.limit + 1);
}

export async function contactEmailTaken(db: Executor, companyId: string, email: string, exceptId: string | null): Promise<boolean> {
  const rows = await db
    .select({ id: growthContacts.id })
    .from(growthContacts)
    .where(
      and(
        eq(growthContacts.companyId, companyId),
        sql`lower(${growthContacts.email}) = lower(${email})`,
        isNull(growthContacts.archivedAt),
        exceptId === null ? undefined : sql`${growthContacts.id} <> ${exceptId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** True when the user is an active CGO (the database trigger enforces the same rule). */
export async function isActiveCgo(db: Executor, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active"), eq(users.role, "cgo")))
    .limit(1);
  return rows.length > 0;
}

// Explicit column lists below: crm_app may insert only these columns.

export async function insertCompany(
  tx: Tx,
  input: { name: string; websiteUrl: string | null; industry: string | null; notes: string | null; ownerId: string; createdBy: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO growth_companies (name, website_url, industry, notes, owner_id, created_by)
    VALUES (${input.name}, ${input.websiteUrl}, ${input.industry}, ${input.notes}, ${input.ownerId}, ${input.createdBy})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Company insert returned no row");
  return row.id;
}

export async function updateCompany(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof growthCompanies.$inferInsert, "name" | "websiteUrl" | "industry" | "notes">>,
): Promise<void> {
  await tx
    .update(growthCompanies)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(growthCompanies.id, id));
}

export async function archiveCompany(tx: Tx, id: string): Promise<void> {
  await tx.update(growthCompanies).set({ archivedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(growthCompanies.id, id));
}

export async function insertContact(
  tx: Tx,
  input: {
    companyId: string;
    fullName: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    websiteUrl: string | null;
    doNotContact: boolean;
    ownerId: string;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO growth_contacts (company_id, full_name, role_title, email, phone, linkedin_url, website_url, do_not_contact, owner_id)
    VALUES (${input.companyId}, ${input.fullName}, ${input.roleTitle}, ${input.email}, ${input.phone}, ${input.linkedinUrl},
            ${input.websiteUrl}, ${input.doNotContact}, ${input.ownerId})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Contact insert returned no row");
  return row.id;
}

export async function updateContact(
  tx: Tx,
  id: string,
  fields: Partial<
    Pick<typeof growthContacts.$inferInsert, "fullName" | "roleTitle" | "email" | "phone" | "linkedinUrl" | "websiteUrl" | "doNotContact">
  >,
): Promise<void> {
  await tx
    .update(growthContacts)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(growthContacts.id, id));
}

export async function archiveContact(tx: Tx, id: string): Promise<void> {
  await tx.update(growthContacts).set({ archivedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(growthContacts.id, id));
}
