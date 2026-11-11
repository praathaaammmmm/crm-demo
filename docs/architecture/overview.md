# Architecture Overview

This document describes how the internal CRM is built and how to extend it. Every agent and developer must also follow [AGENTS.md](../../AGENTS.md).

## Goals

- Grow from a small founder team to a larger company without a rewrite.
- One predictable way to add features.
- Secure by design: least privilege, approvals, append-only audit.
- Concise: no infrastructure or abstraction until a real need exists.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (`strict`) everywhere |
| Runtime | Node.js 26 (the only supported runtime; `engines` is `>=26 <27`) |
| Workspace | npm workspaces (`npm@12.2.2`), compiled with `tsc -b` |
| Web UI | Next.js (App Router), CSS Modules. UI only, no business rules |
| API | Fastify, Zod-validated routes |
| Worker | Second entry point of the API app (`worker.ts`), separate process |
| Database | PostgreSQL 18. Reviewed SQL migrations are the source of truth; Drizzle ORM is used only for typed queries |
| Background work | Transactional outbox table polled by the worker (see [outbox.md](outbox.md)) |
| Tests | Vitest (unit + integration against real PostgreSQL), Playwright (end-to-end) |

## System shape

```
Browser ──► Next.js (UI only) ──/api/v1/*──► Fastify API ──► PostgreSQL
                                             │  modules/*        ▲
                                             │  (same code)      │ outbox_events
                                             └─ Worker process ──┘
```

It is a **modular monolith**: one backend codebase, organised by business module, deployed as two processes (HTTP API and worker). There are no microservices. See [ADR 0001](../adrs/0001-modular-monolith.md).

## Repository layout

```
apps/
  web/                      Next.js UI
    src/app/                routes and layouts only
    src/features/<module>/  UI for one business module
    src/components/         shared presentational components
    src/lib/                typed API client, session helper
  api/                      backend: HTTP API + worker
    src/modules/<module>/   one folder per business module
    src/platform/           plumbing with no business rules (http, outbox, errors, env, context)
    src/server.ts           HTTP entry point
    src/worker.ts           worker entry point
    src/bootstrap.ts        one-time Super Admin creation
    test/                   test helpers and database-level tests
packages/
  contracts/                Zod request/response schemas shared by web and api
  permissions/              roles, permission catalog, can(), approval-gated actions
  database/                 SQL migrations (source of truth), Drizzle table definitions for typed queries, connection setup, migration runner
  config/                   shared tsconfig and ESLint rules
docs/                       architecture, security, ADRs, API, product, runbooks
infra/docker/postgres/      local database role setup
tests/e2e/                  Playwright tests
```

Folders are created only when real code exists for them. Future modules (projects, tasks, meetings, notifications, clients, crm, marketing, finance, engineering, automations, integrations, ai), `packages/ui`, `apps/portal` and `infra/deployment` do not exist until they are approved and built.

## Request lifecycle

Every API request follows the same path:

```
route (thin)
  → validate input against the contract
  → service(ctx, input)
       authorize via the module policy
       BEGIN
         repository writes
         audit.record(tx, …)
         outbox insert (only when the module publishes events)
       COMMIT
  → map result to the response contract
```

`ctx` is `{ actor, requestId }`. The actor type is `user`, `system` (worker), `bootstrap` (one-time setup) or `anonymous` (unauthenticated login attempts).

## Standard module structure

Example: `apps/api/src/modules/tasks/`

| File | Responsibility |
|---|---|
| `index.ts` | The module's only public surface: route plugin, functions other modules may call, event and approval handlers |
| `tasks.routes.ts` | Thin: validate with the contract, call one service function, return the response |
| `tasks.service.ts` | Business rules. Functions take `(ctx, input)`, authorize first, own the transaction, record audit |
| `tasks.repository.ts` | The only place that queries this module's tables. Receives the transaction |
| `tasks.policy.ts` | Permission decisions and list scopes, built on `packages/permissions` |
| `tasks.audit.ts` | Audit action names and the field allowlist for before/after snapshots |
| `tasks.handlers.ts` | Only if needed: outbox event handlers |
| `tasks.approvals.ts` | Only if needed: actions that run after CEO approval |
| `tasks.test.ts`, `tasks.policy.test.ts` | Integration and policy tests |

The rest of a feature lives in:

- `packages/contracts/src/tasks.ts`: API schemas
- `packages/permissions/src/catalog/tasks.ts`: permission names
- `packages/database/src/schema/tasks.ts`: tables
- `apps/web/src/features/tasks/`: UI

## Code rules

1. A route calls exactly one service function and contains no business rules.
2. Every service function authorizes first, including when the worker calls it as the `system` actor.
3. A repository queries only its own module's tables. To reach another module, call that module's `index.ts`.
4. List endpoints filter in SQL using the policy's scope. They never load everything and filter in code.
5. A resource the caller may not see returns 404 (see [API conventions](../api/conventions.md)).
6. Errors are typed in `platform/errors.ts` and mapped to HTTP in one place.
7. `platform/` contains no business rules. Modules contain no HTTP-server plumbing.
8. Packages never import from apps. Apps never import from other apps.

Import boundaries are enforced with ESLint `no-restricted-imports`.

## Dependency direction

```
apps/web     → contracts, permissions
apps/api     → contracts, permissions, database
contracts    → permissions (role list), zod
permissions  → nothing
database     → drizzle-orm, pg
```

## Adding a new module

1. Check whether an existing module should be extended instead.
2. Write `docs/product/<module>.md`. Add an ADR only for a new pattern or dependency.
3. Add contracts: `packages/contracts/src/<module>.ts`.
4. Add permissions: `catalog/<module>.ts`, grant them in `roles.ts`, add approval-gated actions to `approvals.ts`, update the matrix test and [rbac-matrix.md](../security/rbac-matrix.md).
5. Write a reviewed SQL migration for the new tables, constraints, indexes and grants (see "Database migrations" below), then mirror the tables in `packages/database/src/schema/<module>.ts` for typed queries. New tables have no access until a migration grants it.
6. Create the module folder with only the files it needs, and register it through `index.ts`.
7. Record an audit event for every sensitive change, with a field allowlist.
8. Write policy and integration tests, including the expected audit rows.
9. Add the UI under `apps/web/src/features/<module>/` and `apps/web/src/app/(internal)/<module>/`.

Migration rules for new tables:

- Use expand/contract: add nullable → backfill → enforce in a later migration.
- Never rename or drop a column in the same release that stops using it.
- Archive with `archived_at` instead of deleting rows.
- Destructive migrations require explicit user approval.

## Database migrations

Phase 1 follows a **SQL-first** policy.

- The reviewed SQL files in `packages/database/migrations/` are the source of truth for the schema, constraints, triggers, functions and grants.
- Migrations are applied only by the project's runner, `packages/database/src/migrate.ts` (`npm run db:migrate`). It refuses to run unless connected as `crm_migrator`, and applies pending files in order inside one transaction using Drizzle's migrator.
- Migrations are never generated from the TypeScript table definitions, and no Drizzle snapshot files exist or may be fabricated.
- Drizzle ORM is used only for typed application queries. The table definitions in `packages/database/src/schema/` must mirror the SQL; the SQL wins if they differ.

Adding a migration:

1. Create `packages/database/migrations/NNNN_short_name.sql` with the next number. Separate statements with `--> statement-breakpoint`.
2. Add a matching entry to `packages/database/migrations/meta/_journal.json`: next `idx`, `tag` equal to the file name without `.sql`, `breakpoints: true`, and a `when` value (milliseconds) greater than every earlier entry.
3. Update the Drizzle table definitions to match.
4. Add grants explicitly. New tables and functions have no access until granted.
5. Have the migration reviewed. Destructive changes need explicit user approval.
6. Never edit a migration that has been applied anywhere; add a new one instead.

## Keeping the code concise

- Create files and folders only for real code. No `utils` dumping grounds, base classes or generic repositories.
- Services are plain functions taking `(ctx, input)`. No dependency-injection framework.
- Add an abstraction only when a second real use exists.
- Every new dependency needs user approval and an ADR.
- Define each schema once (contracts for the API, `database` for tables) and infer types from it.
- No cache, message broker, search engine or separate service until measurements show the need.
- Split a service file by business area when it grows past about 300 lines.
- Comment only where the code cannot explain why.

## Scaling path

- The API is stateless (sessions live in the database), so instances can be added.
- Worker replicas are safe: events are claimed with `FOR UPDATE SKIP LOCKED`.
- A PostgreSQL read replica can serve reporting queries later.
- `audit_events` can be partitioned by month when it grows large.
- A module can be extracted into a separate service only if measurements justify it.

## Phase 1 specifics

- Modules: `identity`, `organization`, `approvals`, `audit`, `system`.
- The API publishes no outbox events in Phase 1, so `crm_app` has no rights on `outbox_events` and `platform/outbox/publish.ts` does not exist yet. Both arrive in Phase 2 with meetings.
- Shared UI components live in `apps/web/src/components/` because there is only one UI app.

## Related documents

- [Outbox](outbox.md)
- [Database roles](../security/database-roles.md)
- [RBAC matrix](../security/rbac-matrix.md)
- [Audit policy](../security/audit-policy.md)
- [Authentication](../security/authentication.md)
- [Privacy and attendance](../security/privacy-and-attendance.md)
- [API conventions](../api/conventions.md)
- [Phase 1 product scope](../product/phase-1.md)
