# ADR 0005: Everyone Reports Directly to the CEO/CTO

- Status: Accepted
- Date: 2026-11-11

## Context

Organisation rule: the CEO/CTO is the only Super Admin, and every other person (founders, employees, interns, contractors, CFO, CGO, CMO, VP) reports directly to the CEO/CTO. Nobody else may be another user's manager unless this rule is explicitly changed.

## Decision

Enforce the rule in both the database and the service layer.

### Database (the guarantee)

```
users
  role                       user_role NOT NULL
  is_super_admin             boolean NOT NULL DEFAULT false
  reports_to_user_id         uuid NULL
  reports_to_is_super_admin  boolean NULL
  status                     user_status NOT NULL DEFAULT 'active'

UNIQUE (id, is_super_admin)
UNIQUE INDEX users_one_super_admin ON users (is_super_admin) WHERE is_super_admin
CHECK (is_super_admin = (role = 'ceo_cto'))
CHECK (is_super_admin = (reports_to_user_id IS NULL))
CHECK (reports_to_is_super_admin IS DISTINCT FROM false)
CHECK (NOT (is_super_admin AND status = 'deactivated'))
FOREIGN KEY (reports_to_user_id, reports_to_is_super_admin)
  REFERENCES users (id, is_super_admin) MATCH FULL
```

- `MATCH FULL` requires both reporting columns to be NULL (the Super Admin) or both to be set. A plain composite foreign key would skip the check when only one column is NULL, which would allow a reporting line that is never verified.
- `reports_to_is_super_admin` can only be NULL or `true`, so the foreign key can only point at the row with `is_super_admin = true`, and at most one exists. Every non-CEO user's manager is therefore the CEO/CTO.
- A `BEFORE INSERT` trigger sets `reports_to_user_id` to the Super Admin's ID and `reports_to_is_super_admin = true` for every non-Super-Admin row, overriding any supplied value. It raises an error if no Super Admin exists.
- `crm_app` has no grants on `is_super_admin`, `reports_to_user_id` or `reports_to_is_super_admin`. It cannot create a Super Admin or change a reporting line.
- The CEO/CTO cannot be given another role or deactivated.
- The foreign key is not deferrable. It is checked on every statement.

### Service layer

- The `organization` contracts have no manager field.
- Creating users and changing roles never touch reporting columns.
- Role changes cannot set `ceo_cto`.
- Project roles added later (lead, reviewer, assignee, approver) are not managers and grant no access to a person's data.

## Consequences

- The rule cannot be broken by application bugs or direct SQL from application roles.
- Super Admin transfer is not supported in Phase 1. Deferring the foreign key alone would not make it safe, because the single-Super-Admin constraints and the reporting-line trigger still apply. Transfer requires a future, separately approved migration and recovery design ([break-glass runbook](../runbooks/super-admin-break-glass.md)).
- Introducing managers later requires explicit user approval, a migration relaxing these constraints, and a new ADR superseding this one.

## Tests

- `apps/api/test/hierarchy.test.ts`: second Super Admin rejected; reporting line forced to the CEO; CEO role and status protected; non-CEO manager impossible.
- `modules/organization/organization.test.ts`: user creation and role changes keep the reporting line on the CEO.
