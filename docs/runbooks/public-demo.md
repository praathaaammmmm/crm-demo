# Public read-only demo

A separate deployment of this app for the portfolio. All data is fictional. Visitors can sign in and look
around, and the API refuses every change.

## Isolation rules

- Use a dedicated demo database, API and web deployment. Never reuse the staging database, staging API or
  staging web app, and never point a demo variable at them.
- Use only fictional data and `@example.test` accounts (`packages/contracts/src/demo.ts`).
- Never commit `DEMO_ACCOUNT_PASSWORD` or `DEMO_LOGIN_PASSWORD`. Keep them in the hosting provider's settings only.

## How read-only mode works

- When `DEMO_MODE=true` on the API, `registerDemoMode` (`apps/api/src/platform/http/demo-mode.ts`) adds a
  global `onRequest` hook. It runs before the Origin check, routing, body parsing, sessions and services.
- GET, HEAD and OPTIONS are allowed. The only allowed writes are exact matches for
  `POST /api/v1/auth/login` and `POST /api/v1/auth/logout`.
- Every other request gets `403 {"code":"DEMO_READ_ONLY","message":"This public demo is read-only."}`.
  Password changes are refused too.
- Failed sign-ins do not count toward lockout in demo mode, so visitors cannot lock the shared accounts.
  The per-IP login rate limit still applies.
- Signing in still writes a session row and a login attendance event. This growth is accepted for now.
- With `DEMO_MODE=true`, the web app shows the "Demo data — changes are not saved" banner and lists the demo
  accounts on `/login`. Buttons stay visible, and submitting a form shows the read-only message.
- The worker is not deployed for the demo.

## Environment

| Where | Variable | Value |
| --- | --- | --- |
| API | `DEMO_MODE` | `true` |
| API | `APP_ORIGIN` | the demo web URL |
| API | `DATABASE_URL_APP` | demo database, `crm_app` role |
| API | `ORG_TIMEZONE`, `NODE_ENV=production`, `LOG_LEVEL=info` | |
| Web | `DEMO_MODE` | `true` |
| Web | `API_INTERNAL_URL` | the demo API URL |
| Web | `DEMO_LOGIN_PASSWORD` | the shared demo password, shown publicly on `/login` |
| Seed (one-off) | `DATABASE_URL_MIGRATOR`, `DATABASE_URL_APP` | demo database only |
| Seed (one-off) | `DEMO_SEED_CONFIRM` | the demo database name, e.g. `crm_demo` |
| Seed (one-off) | `DEMO_ACCOUNT_PASSWORD` | the same value as `DEMO_LOGIN_PASSWORD` (12–128 characters) |
| Seed (one-off) | `ORG_TIMEZONE` | the same value as the API |

## Seeding (manual, only with approval)

1. Create an empty database named `crm_demo` (or `crm_demo_<suffix>`) with the roles from
   `docs/security/database-roles.md`.
2. Apply migrations to that database only: `npm run db:migrate` with `DATABASE_URL_MIGRATOR` set to it.
3. Build, then run `npm run demo:seed -w @crm/api` with the seed variables set in the shell. This script
   does not load `.env`.
4. The seed refuses to run unless the database name matches `crm_demo*`, equals `DEMO_SEED_CONFIRM`, and
   has no users.

## Manual reset (later)

The seed only runs on an empty database. To reset the demo:

1. Drop and recreate the demo database. This is a destructive action and needs explicit approval.
2. Re-run migrations and the seed.

There is no automated reset yet.
