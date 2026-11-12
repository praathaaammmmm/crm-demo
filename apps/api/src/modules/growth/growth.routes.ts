import {
  companyListQuerySchema,
  companyPageSchema,
  companyResponseSchema,
  contactListQuerySchema,
  contactPageSchema,
  contactResponseSchema,
  createCompanyRequestSchema,
  createContactRequestSchema,
  idParamsSchema,
  updateCompanyRequestSchema,
  updateContactRequestSchema,
  type Company,
  type Contact,
} from "@crm/contracts/growth";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import * as policy from "./growth.policy.js";
import type { CompanyRow, ContactRow } from "./growth.repository.js";
import * as service from "./growth.service.js";

export interface GrowthRouteOptions extends service.GrowthDeps {
  requireUser: ReturnType<typeof requireSession>;
}

// Explicit allowlists of response fields.

const iso = (date: Date | null) => (date ? date.toISOString() : null);

const companyBody = (row: CompanyRow): Company => ({
  id: row.id,
  name: row.name,
  websiteUrl: row.websiteUrl,
  industry: row.industry,
  notes: row.notes,
  ownerId: row.ownerId,
  ownerFlagged: row.ownerFlagged,
  contactCount: row.contactCount,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: iso(row.archivedAt),
});

const contactBody = (row: ContactRow): Contact => ({
  id: row.id,
  companyId: row.companyId,
  fullName: row.fullName,
  roleTitle: row.roleTitle,
  email: row.email,
  phone: row.phone,
  linkedinUrl: row.linkedinUrl,
  websiteUrl: row.websiteUrl,
  doNotContact: row.doNotContact,
  ownerId: row.ownerId,
  ownerFlagged: row.ownerFlagged,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: iso(row.archivedAt),
  companyArchived: row.companyArchived,
});

/**
 * Repository convention: the endpoint permission is checked first (403), then a malformed id is
 * reported as 404, like a well-formed id that names no visible record.
 */
function idFrom(request: FastifyRequest, permission: (user: AuthSession["user"]) => void): string {
  permission(authOf(request).user);
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

export function growthRoutes({ requireUser, ...deps }: GrowthRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const oneCompany = (row: CompanyRow) => toResponse(companyResponseSchema, { company: companyBody(row) });
    const oneContact = (row: ContactRow) => toResponse(contactResponseSchema, { contact: contactBody(row) });

    // Companies

    app.get("/companies", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(companyListQuerySchema, request.query);
      const result = await service.listCompanies(deps, user(request), query);
      return reply.code(200).send(toResponse(companyPageSchema, { items: result.items.map(companyBody), nextCursor: result.nextCursor }));
    });

    app.post("/companies", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createCompanyRequestSchema, request.body);
      return reply.code(201).send(oneCompany(await service.createCompany(deps, contextFrom(request), user(request), input)));
    });

    app.get("/companies/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      return reply.code(200).send(oneCompany(await service.getCompany(deps, user(request), id)));
    });

    app.patch("/companies/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      await service.getCompany(deps, user(request), id); // 404 before 400 for unknown ids
      const input = parseInput(updateCompanyRequestSchema, request.body);
      return reply.code(200).send(oneCompany(await service.updateCompany(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/companies/:id/archive", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      return reply.code(200).send(oneCompany(await service.archiveCompany(deps, contextFrom(request), user(request), id)));
    });

    // Contacts

    app.get("/companies/:id/contacts", { preHandler: requireUser }, async (request, reply) => {
      const companyId = idFrom(request, policy.assertCanReadContacts);
      const query = parseInput(contactListQuerySchema, request.query);
      const result = await service.listContacts(deps, user(request), companyId, query);
      return reply.code(200).send(toResponse(contactPageSchema, { items: result.items.map(contactBody), nextCursor: result.nextCursor }));
    });

    app.post("/companies/:id/contacts", { preHandler: requireUser }, async (request, reply) => {
      const companyId = idFrom(request, policy.assertCanManage);
      await service.getCompany(deps, user(request), companyId); // 404 before 400 for unknown ids
      const input = parseInput(createContactRequestSchema, request.body);
      return reply.code(201).send(oneContact(await service.createContact(deps, contextFrom(request), user(request), companyId, input)));
    });

    app.get("/contacts/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanReadContacts);
      return reply.code(200).send(oneContact(await service.getContact(deps, user(request), id)));
    });

    app.patch("/contacts/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      await service.getContact(deps, user(request), id); // 404 before 400 for unknown ids
      const input = parseInput(updateContactRequestSchema, request.body);
      return reply.code(200).send(oneContact(await service.updateContact(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/contacts/:id/archive", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      return reply.code(200).send(oneContact(await service.archiveContact(deps, contextFrom(request), user(request), id)));
    });

    done();
  };
}
