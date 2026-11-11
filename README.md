# CRM

Internal CRM for the company: roles and approvals, audit, attendance, and later tasks, projects, meetings, clients and department modules.

**Status:** Phase 1 in progress. Workspace configuration exists; dependencies are not installed and there is no application code yet.

All contributors and coding agents must follow [AGENTS.md](AGENTS.md).

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Transactional outbox](docs/architecture/outbox.md)
- [Security](docs/security/): RBAC matrix, database roles, audit policy, authentication, privacy and attendance
- [API conventions](docs/api/conventions.md)
- [Phase 1 scope](docs/product/phase-1.md)
- [Architecture decisions](docs/adrs/)
- [Runbooks](docs/runbooks/)

## Workspace

```
apps/web             Next.js UI
apps/api             Fastify API + worker
packages/contracts   shared API schemas
packages/permissions roles and permission rules
packages/database    tables, migrations, connection
packages/config      shared TypeScript and ESLint settings
```

## Prerequisites

- Node.js 26 (the only supported runtime)
- npm 12.2.2 (bundled with Node; the project uses npm workspaces)
- Docker (for the local PostgreSQL database)

## Setup

These steps become usable as Phase 1 checkpoints are completed.

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Install dependencies: `npm install`.
3. Start PostgreSQL (Docker Compose file to be added).
4. Build: `npm run build`.
5. Apply migrations: `npm run db:migrate`.
6. Create the Super Admin once: `npm run bootstrap` ([runbook](docs/runbooks/super-admin-bootstrap.md)).

## Database migrations

Migrations are hand-written, reviewed SQL files in `packages/database/migrations/`, applied by `npm run db:migrate`. They are never generated from code. See [Database migrations](docs/architecture/overview.md#database-migrations).

## Development

Run each in its own terminal:

```
npm run build:watch -w @crm/api
npm run dev:server -w @crm/api
npm run dev:worker -w @crm/api
npm run dev -w @crm/web
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` | Compile packages and API, build the web app |
| `npm run typecheck` | Type-check everything |
| `npm run lint` | ESLint, including import-boundary rules |
| `npm run format` / `npm run format:check` | Prettier |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` | Apply reviewed SQL migrations as `crm_migrator` |
| `npm run bootstrap` | One-time Super Admin creation |
