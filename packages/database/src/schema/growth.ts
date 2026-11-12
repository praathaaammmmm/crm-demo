import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

/**
 * Growth companies. Owners must be active CGOs when assigned (trigger growth_owner_guard) and can never be
 * the CEO/CTO (MATCH FULL composite foreign key). Archived companies are read-only (trigger), never deleted.
 */
export const growthCompanies = pgTable(
  "growth_companies",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    industry: text("industry"),
    notes: text("notes"),
    ownerId: uuid("owner_id").notNull(),
    ownerIsSuperAdmin: boolean("owner_is_super_admin").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "growth_companies_owner_fk", columns: [t.ownerId, t.ownerIsSuperAdmin], foreignColumns: [users.id, users.isSuperAdmin] }),
    uniqueIndex("growth_companies_name_unique").on(sql`lower(${t.name})`).where(sql`archived_at IS NULL`),
    index("growth_companies_owner_idx").on(t.ownerId),
    check("growth_companies_owner_not_super_admin", sql`owner_is_super_admin = false`),
    check("growth_companies_name_normalized", sql`name = regexp_replace(btrim(name), '\\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200`),
    check("growth_companies_industry", sql`industry IS NULL OR (industry = btrim(industry) AND char_length(industry) BETWEEN 1 AND 100)`),
    check("growth_companies_notes", sql`notes IS NULL OR (notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 5000)`),
    check(
      "growth_companies_website_https",
      sql`website_url IS NULL OR (website_url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(website_url) <= 2000)`,
    ),
  ],
);

/** Contacts are external personal data: visible only with growth:read_contacts. Never deleted. */
export const growthContacts = pgTable(
  "growth_contacts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => growthCompanies.id),
    fullName: text("full_name").notNull(),
    roleTitle: text("role_title"),
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    websiteUrl: text("website_url"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    ownerId: uuid("owner_id").notNull(),
    ownerIsSuperAdmin: boolean("owner_is_super_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "growth_contacts_owner_fk", columns: [t.ownerId, t.ownerIsSuperAdmin], foreignColumns: [users.id, users.isSuperAdmin] }),
    unique("growth_contacts_id_company_unique").on(t.id, t.companyId),
    uniqueIndex("growth_contacts_company_email_unique").on(t.companyId, sql`lower(${t.email})`).where(sql`archived_at IS NULL AND email IS NOT NULL`),
    index("growth_contacts_company_idx").on(t.companyId),
    check("growth_contacts_owner_not_super_admin", sql`owner_is_super_admin = false`),
    check(
      "growth_contacts_name_normalized",
      sql`full_name = regexp_replace(btrim(full_name), '\\s+', ' ', 'g') AND char_length(full_name) BETWEEN 1 AND 200`,
    ),
    check("growth_contacts_role_title", sql`role_title IS NULL OR (role_title = btrim(role_title) AND char_length(role_title) BETWEEN 1 AND 100)`),
    check("growth_contacts_email", sql`email IS NULL OR (email = lower(btrim(email)) AND email ~ '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' AND char_length(email) <= 254)`),
    check("growth_contacts_phone", sql`phone IS NULL OR (phone = btrim(phone) AND phone ~ '^[0-9+()\\- ]{5,32}$')`),
    check("growth_contacts_linkedin", sql`linkedin_url IS NULL OR (linkedin_url ~ '^https://([a-z]+\\.)?linkedin\\.com/' AND char_length(linkedin_url) <= 2000)`),
    check(
      "growth_contacts_website_https",
      sql`website_url IS NULL OR (website_url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(website_url) <= 2000)`,
    ),
    check("growth_contacts_has_method", sql`num_nonnulls(email, phone, linkedin_url, website_url) >= 1`),
  ],
);
