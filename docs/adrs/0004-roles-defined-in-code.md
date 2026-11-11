# ADR 0004: Roles and Permissions Defined in Code

- Status: Accepted
- Date: 2026-11-11

## Context

The CRM has a fixed set of roles with strict boundaries (one Super Admin; finance-only CFO; growth-only CGO; marketing-only CMO; engineering-only VP; assigned-work-only employees). Changes to what a role may do are high risk and must be reviewed.

## Decision

- Roles, permission names and role grants live in `packages/permissions`.
- `can(actor, permission)` is a pure function with no database access. Unknown or ungranted permissions are denied.
- Each module's `*.policy.ts` combines `can()` with resource facts loaded by its repository (for example, project assignment).
- Approval-gated actions are listed in `packages/permissions/src/approvals.ts`.
- Each user has exactly one role, stored in `users.role`. Changing it requires CEO approval.
- `matrix.test.ts` asserts the full role × permission table, and [rbac-matrix.md](../security/rbac-matrix.md) documents it.

## Consequences

- Every change to role permissions goes through code review, a test change and a deployment.
- The UI and API share the same definitions.
- Custom roles cannot be created at runtime. This is acceptable for an internal team.
- One role per user: a person needing two roles' permissions requires a later migration to support multiple roles.

## Alternatives rejected

- **Roles and permissions editable in the database:** flexible, but lets runtime changes widen access without review.
- **A `role_assignments` table now:** supports multiple roles, but adds a table and complexity with no current need.
- **PostgreSQL row-level security as the main mechanism:** harder to test and reason about. May be added later as a second layer.
