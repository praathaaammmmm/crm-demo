# Runbook: Super Admin Bootstrap

Creates the CEO/CTO Super Admin account. Run once per environment, after migrations.

## Preconditions

- Migrations have been applied as `crm_migrator`.
- No Super Admin exists. The command refuses to run otherwise.
- The operator is the CEO/CTO or acts on their direct instruction.
- These environment variables are set:
  - `DATABASE_URL_MIGRATOR`
  - `BOOTSTRAP_ADMIN_EMAIL`
  - `BOOTSTRAP_ADMIN_NAME`

The password is **never** placed in environment variables, files or shell history.

## Steps

1. Run `npm run bootstrap` from the project root.
2. Enter the password at the hidden prompt (12 to 128 characters), then confirm it.
3. The command, in one transaction as `crm_migrator`:
   - checks that no Super Admin exists
   - inserts the user with `role = 'ceo_cto'`, `is_super_admin = true`, `must_change_password = false`
   - records audit `system.super_admin_bootstrapped` with actor type `bootstrap`
4. Sign in at `/login` with the new account.

## Verification

- Sign-in succeeds and `/users`, `/approvals` and `/audit` are accessible.
- The audit log shows `system.super_admin_bootstrapped`.

## If something goes wrong

- **"Super Admin already exists":** do not retry and do not edit the database manually. Phase 1 has no recovery or transfer procedure; see the [break-glass runbook](super-admin-break-glass.md).
- **Database connection error:** check `DATABASE_URL_MIGRATOR` and that migrations ran. Nothing is written on failure.

## Security notes

- Clear `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME` from the environment after use.
- Do not share the migrator credentials with application processes.
