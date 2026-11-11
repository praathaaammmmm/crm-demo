# Runbook: Super Admin Break-Glass

Emergency procedures that act on the Super Admin account outside the application. They must be rare, deliberate and audited.

## Phase 1 status

**No break-glass procedure is available in Phase 1.**

| Procedure | Status |
|---|---|
| Super Admin transfer (CEO/CTO role moves to another person) | Not supported. Requires a future, separately approved migration and recovery design |
| Super Admin password recovery (`reset-super-admin-password`) | Requirements approved below; not implemented in Phase 1 |

Do not change `is_super_admin`, `role`, `reports_to_user_id` or `reports_to_is_super_admin` with manual SQL. The database constraints in [ADR 0005](../adrs/0005-direct-report-hierarchy.md) are designed to block it.

## Rules for every break-glass action

- Requires `crm_migrator` access. Application roles cannot perform it.
- Requires explicit written approval from the CEO/CTO, or from the company's legal decision-makers if the CEO/CTO is unavailable. Record who approved, who ran it and why.
- A verified database backup is taken first.
- Runs in a single transaction. Any error rolls everything back.
- **Every session ended by the action:**
  - sets `sessions.ended_at` to the revocation timestamp and `sessions.end_reason = 'revoked'`
  - inserts an `attendance_events` row with `kind = 'session_end'` and `occurred_at` = the same revocation timestamp

  Both happen in the same transaction. No revoked session may be left without its attendance record.
- Records an append-only audit event with `actor_type = 'bootstrap'` in the same transaction.

## Super Admin transfer

Not available in Phase 1.

The single-Super-Admin constraints, the reporting-line foreign key and the reporting-line trigger make a safe transfer a design problem of its own, not a SQL script. A future design must define, with separate approval:

- the migration or controlled database function that performs the transfer
- how all reporting lines move to the new Super Admin
- how both accounts' sessions are revoked, with attendance `session_end` records
- the audit event and its fields
- tests proving the constraints hold before and after

## Future: `reset-super-admin-password` mode

Approved as requirements only. **Not implemented in Phase 1.** It will be added as a mode of `apps/api/src/bootstrap.ts` in a later, separately approved change.

### Requirements

1. Connects only as `crm_migrator` (`DATABASE_URL_MIGRATOR`). Refuses to run with any other role.
2. Prompts interactively for the new password with hidden input, asks for it a second time, and asks for an explicit typed confirmation before writing anything. The password is never read from arguments, environment variables or files.
3. Validates the password (12 to 128 characters) and hashes it with argon2id using the settings in [authentication.md](../security/authentication.md).
4. In one transaction:
   - updates the Super Admin's `password_hash`, sets `must_change_password = false`, clears `failed_login_count` and `locked_until`
   - revokes **all** active Super Admin sessions: `ended_at = <revocation timestamp>`, `end_reason = 'revoked'`
   - inserts one `attendance_events` row per revoked session: `kind = 'session_end'`, `occurred_at = <revocation timestamp>`
   - inserts audit `system.super_admin_password_reset` with `actor_type = 'bootstrap'`, `entity_type = 'user'`, `entity_id` = the Super Admin's ID, and `after = { "sessionsRevoked": <count> }`. No password or hash is recorded.
5. Prints only success or failure, never the password or hash.

### Tests required when implemented

- Refuses to run as `crm_app` or `crm_worker`.
- Aborts without changes when the confirmation is not given or the passwords do not match.
- Revokes every active Super Admin session and writes a matching attendance `session_end` for each, at the revocation timestamp.
- Writes exactly one audit event, with no password data.
- Any failure rolls back all changes.
