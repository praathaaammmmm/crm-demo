import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

/** The organisation's currency for Growth values (used from slice 4A.2). */
export const ORG_CURRENCY = "INR";

/** Trims and collapses internal whitespace, so spacing can never bypass duplicate or length rules. */
export const normalizeName = (value: string): string => value.trim().replace(/\s+/g, " ");

const name = z.string().transform(normalizeName).pipe(z.string().min(1).max(200));
/** Optional text: trimmed; empty becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .transform((value) => (value.length === 0 ? null : value));
const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);
const optionalUrl = (schema: z.ZodType<string, string>) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.union([z.literal(""), schema]))
    .transform((value) => (value.length === 0 ? null : value));

export const LINKEDIN_URL = /^https:\/\/([a-z]+\.)?linkedin\.com\//;
export const PHONE = /^[0-9+()\- ]{5,32}$/;

const linkedinUrl = httpsUrl.refine((value) => LINKEDIN_URL.test(value), "Use a linkedin.com link");
const email = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.union([z.literal(""), z.email().max(254)]))
  .transform((value) => (value.length === 0 ? null : value));
const phone = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.union([z.literal(""), z.string().regex(PHONE)]))
  .transform((value) => (value.length === 0 ? null : value));

// Companies

export const createCompanyRequestSchema = z.strictObject({
  name,
  websiteUrl: optionalUrl(httpsUrl).optional(),
  industry: optionalText(100).optional(),
  notes: optionalText(5000).optional(),
});
export type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;

export const updateCompanyRequestSchema = createCompanyRequestSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateCompanyRequest = z.infer<typeof updateCompanyRequestSchema>;

export const companyListQuerySchema = paginationQuerySchema.extend({ archived: z.enum(["true", "false"]).optional() });
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;

export const companySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  websiteUrl: z.string().nullable(),
  industry: z.string().nullable(),
  notes: z.string().nullable(),
  ownerId: z.uuid(),
  /** The owner is no longer an active CGO (flagged until the CEO reassigns; slice 4A.2). */
  ownerFlagged: z.boolean(),
  contactCount: z.int().nonnegative(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});
export type Company = z.infer<typeof companySchema>;

export const companyResponseSchema = z.strictObject({ company: companySchema });
export const companyPageSchema = z.strictObject({ items: z.array(companySchema), nextCursor: nextCursorSchema });

// Contacts

const contactFields = {
  fullName: name,
  roleTitle: optionalText(100).optional(),
  email: email.optional(),
  phone: phone.optional(),
  linkedinUrl: optionalUrl(linkedinUrl).optional(),
  websiteUrl: optionalUrl(httpsUrl).optional(),
  doNotContact: z.boolean().optional(),
};

/** At least one way to reach the contact. */
export const hasContactMethod = (value: {
  email?: string | null | undefined;
  phone?: string | null | undefined;
  linkedinUrl?: string | null | undefined;
  websiteUrl?: string | null | undefined;
}) =>
  [value.email, value.phone, value.linkedinUrl, value.websiteUrl].some((field) => field !== undefined && field !== null);

export const createContactRequestSchema = z
  .strictObject(contactFields)
  .refine(hasContactMethod, { message: "Add an email, phone, LinkedIn or website", path: ["email"] });
export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

/** The contact-method rule is checked against the edited result by the API. */
export const updateContactRequestSchema = z
  .strictObject(contactFields)
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateContactRequest = z.infer<typeof updateContactRequestSchema>;

export const contactListQuerySchema = paginationQuerySchema.extend({ archived: z.enum(["true", "false"]).optional() });
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const contactSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  fullName: z.string(),
  roleTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  doNotContact: z.boolean(),
  ownerId: z.uuid(),
  ownerFlagged: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  /** The parent company is archived: the contact is read-only. */
  companyArchived: z.boolean(),
});
export type Contact = z.infer<typeof contactSchema>;

export const contactResponseSchema = z.strictObject({ contact: contactSchema });
export const contactPageSchema = z.strictObject({ items: z.array(contactSchema), nextCursor: nextCursorSchema });

export const idParamsSchema = z.strictObject({ id: z.uuid() });
