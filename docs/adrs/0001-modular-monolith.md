# ADR 0001: Modular Monolith with Separate UI and API

- Status: Accepted
- Date: 2026-11-11

## Context

The CRM must grow from a small founder team to a larger company, enforce strict permissions, approvals and audit, run background jobs, and later support integrations, a client portal, mobile apps and AI. The team is small, and the codebase must stay understandable to a future developer.

Options considered:

1. TypeScript: Next.js UI + Fastify API + PostgreSQL
2. TypeScript: Next.js as both UI and backend + PostgreSQL
3. Python FastAPI + Next.js + PostgreSQL

## Decision

Option 1, as a modular monolith:

- Next.js serves the UI only.
- Fastify holds every business rule, permission check and audit write.
- The worker is a second entry point (`worker.ts`) of the same API app, deployed as a separate process.
- Code is organised by business module under `apps/api/src/modules/`, each with routes, service, repository, policy and tests.
- Shared code lives in `packages/` (contracts, permissions, database, config).

## Consequences

- One path into the data, so permission checks cannot be bypassed through UI server code.
- One language and one schema library across UI, API and worker.
- The API can serve future mobile apps and a client portal without change.
- Three processes to run (web, API, worker) instead of one.
- Module boundaries depend on discipline; ESLint import rules and review enforce them.
- A module can be extracted into a separate service later if measurements require it.

## Alternatives rejected

- **Next.js-only backend:** server actions and route handlers spread authorization checks across many entry points. A separate worker is still required.
- **FastAPI:** conflicts with the TypeScript requirement in AGENTS.md and adds a second language and toolchain. Python can be added later as a narrow service if AI work requires it.
- **Separate `apps/worker` app:** it would either import from `apps/api` or force all services into a shared package, splitting each module across two places.
