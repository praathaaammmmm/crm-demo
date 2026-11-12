# API Conventions

## Base path and versioning

- All endpoints live under `/api/v1`. Breaking changes require `/api/v2`.
- Health endpoints are outside the version: `GET /health/live`, `GET /health/ready`. They return no data beyond status.

## Format

- JSON request and response bodies.
- Field names in `camelCase`.
- IDs are UUIDv7 strings.
- Timestamps are ISO 8601 in UTC. Calendar dates (`YYYY-MM-DD`) are in `ORG_TIMEZONE`.
- Every request and response is validated against a Zod schema in `packages/contracts`.

## Authentication

- Browser clients use the `crm_session` cookie ([authentication.md](../security/authentication.md)).
- State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must send `Origin` equal to `APP_ORIGIN`.

## Errors

```json
{ "code": "VALIDATION_FAILED", "message": "Human-readable summary" }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Input fails the contract |
| 401 | `UNAUTHENTICATED` | No valid session, or failed login (always generic) |
| 403 | `FORBIDDEN` | The caller lacks the permission for this endpoint or action, or the `Origin` check fails |
| 403 | `PASSWORD_CHANGE_REQUIRED` | The user must change their password first |
| 404 | `NOT_FOUND` | The resource does not exist **or the caller may not see it** |
| 409 | `CONFLICT` | State conflict, e.g. a duplicate pending approval |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL` | Unexpected error. No internal details are returned |

### 404 vs 403

- If the caller may not know a specific resource exists (another user's approval request, a project they are not assigned to), return **404**.
- If the caller lacks permission for the endpoint or action as a whole (an employee calling the audit endpoint), return **403**.

Required approval tests:

| Case | Expected |
|---|---|
| Employee, founder, intern or contractor calls `POST /api/v1/approvals` | 403 |
| Requester lacks the permission for the requested `type` | 403 |
| Non-Super-Admin calls `/approve` or `/reject` | 403 |
| Requester reads or cancels another user's request | 404 |
| Any caller references a request ID that does not exist | 404 |

## Pagination

Lists use cursor pagination:

```
GET /api/v1/audit-events?limit=50&cursor=<opaque>
→ { "items": [...], "nextCursor": "<opaque>" | null }
```

- Default and maximum `limit` is 50 unless an endpoint documents otherwise.
- Cursors are opaque; clients must not parse them.

## Route rules

- Routes are thin: validate, call one service function, return.
- No route updates or deletes audit events.
- No response ever contains `password_hash` or `token_hash`. Response contracts list allowed fields explicitly.
- Removal is archiving (`archived_at`), exposed as an explicit action, never a raw `DELETE` of a record.

## Phase 1 endpoints

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/auth/login` | public (rate limited) |
| POST | `/api/v1/auth/logout` | authenticated |
| GET | `/api/v1/auth/me` | authenticated |
| POST | `/api/v1/auth/password` | authenticated |
| GET | `/api/v1/users` | `users:read_directory` (email needs `users:read_email`) |
| POST | `/api/v1/users` | `users:create` |
| POST | `/api/v1/users/:id/reset-access` | `users:reset_access` (never the CEO/CTO or the caller) |
| POST | `/api/v1/approvals` | `approvals:request_role_change` or `approvals:request_deactivation`, by type |
| GET | `/api/v1/approvals` | requesters see their own; `approvals:read_all` sees all |
| POST | `/api/v1/approvals/:id/approve` | `approvals:decide` |
| POST | `/api/v1/approvals/:id/reject` | `approvals:decide` |
| POST | `/api/v1/approvals/:id/cancel` | the requester, while pending |
| GET | `/api/v1/audit-events` | `audit:read` |
| GET | `/api/v1/attendance/me` | `attendance:read_own` |
| GET | `/api/v1/attendance` | `attendance:read_all` |

## API documentation

OpenAPI generated from the contracts is planned for a later phase and requires approval of `@fastify/swagger`.
