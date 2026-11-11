# Authentication and Sessions

Authentication uses sessions stored in our own database. No external identity provider. See [ADR 0003](../adrs/0003-own-session-auth.md).

## Settings (Phase 1)

| Setting | Value |
|---|---|
| Session duration | 12 hours, fixed from login. No sliding renewal. Set and enforced by the database |
| Password hashing | argon2id, `m = 19456 KiB`, `t = 2`, `p = 1` |
| Password length | 12 to 128 characters |
| Account lockout | 5 consecutive failures lock the account for 15 minutes |
| Login rate limit | 10 requests per minute per IP |
| Session token | 32 random bytes; only `sha256(token)` is stored |

## Cookie

`crm_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`, `Secure` outside local development.

## Endpoints

### `POST /api/v1/auth/login` — `{ email, password }`

1. Lower-case the email and load the user.
2. Unknown email: run a dummy argon2 verification so response time matches, then return a generic `401`.
3. Locked (`locked_until > now()`) or deactivated account: the same generic `401`.
4. Wrong password: increment `failed_login_count`. On the fifth failure set `locked_until = now() + 15 min`, reset the count and record audit `user.account_locked`.
5. Success, in one transaction:
   - reset `failed_login_count`
   - generate the token and insert the session with only `user_id` and `token_hash`. The database sets `created_at = now()` and `expires_at = now() + 12 hours`, and a `CHECK` rejects any other duration. `crm_app` has no grant on either column.
   - insert attendance `login` with `occurred_at` = the session's `created_at`
6. Set the cookie and return `{ user, mustChangePassword }`.

A new token is issued on every login.

### Session check (every authenticated request)

The session is valid only if the token hash matches, `ended_at IS NULL`, `expires_at > now()` and the user is active. Otherwise `401`.

**The check writes nothing.** There is no last-seen time or activity tracking.

### Forced password change

While `must_change_password` is true, every route except `/auth/me`, `/auth/password` and `/auth/logout` returns `403 PASSWORD_CHANGE_REQUIRED`.

### `POST /api/v1/auth/password` — `{ currentPassword, newPassword }`

Verifies the current password, stores the new hash, sets `must_change_password = false`, ends the user's **other** sessions (`end_reason = revoked`, attendance `session_end` at `now()`) and records audit `user.password_changed`.

### `POST /api/v1/auth/logout`

Sets `ended_at = now()`, `end_reason = logout`, records attendance `session_end` at that time and clears the cookie. Repeating it is harmless.

### `GET /api/v1/auth/me`

Returns the current user.

## Session end

| Cause | `ended_at` | `end_reason` | Attendance `session_end` time |
|---|---|---|---|
| Logout | `now()` | `logout` | `now()` |
| Expiry | `expires_at` | `expired` | `expires_at` |
| Password change (other sessions) | `now()` | `revoked` | `now()` |
| Role change or deactivation | `now()` | `revoked` | `now()` |

An expired session stops working at `expires_at` immediately. The worker's sweep later records the end at the **configured expiry time**, not the time the sweep runs ([outbox.md](../architecture/outbox.md)).

## Cross-site request protection

- `SameSite=Strict` cookie.
- Every state-changing request must carry an `Origin` header equal to `APP_ORIGIN`. Otherwise `403`.
- The browser reaches the API on the same origin through the Next.js `/api/*` rewrite, so no CORS is configured.

## Account creation

- The Super Admin is created once by `bootstrap.ts` ([runbook](../runbooks/super-admin-bootstrap.md)).
- Other users are created by the Super Admin with a temporary password and `must_change_password = true`.
- No self-registration, no password reset by email in Phase 1.

## Future two-factor authentication

Login is two steps: `verifyCredentials()` then `createSession()`. A future two-factor step goes between them. No two-factor code, columns or dependency exist in Phase 1. Adding it requires explicit approval.

## Logging and credential hashes

Passwords, tokens, cookies and `Authorization` headers are redacted. Request bodies are never logged.

`crm_app` can read `users.password_hash` and `sessions.token_hash` for login and session checks. Neither value may appear in any API response, log line or audit record ([database-roles.md](database-roles.md#credential-hashes)).
