# ADR 0003: Own Database Session Authentication

- Status: Accepted
- Date: 2026-11-11

## Context

The CRM needs password sign-in for an internal team, attendance based only on login and session-end times, immediate revocation on role change or deactivation, and no external services without approval.

## Decision

- Sessions are stored in our own `sessions` table.
- Passwords are hashed with argon2id (`m = 19456 KiB, t = 2, p = 1`) using `@node-rs/argon2`.
- Session tokens are 32 random bytes; only their SHA-256 hash is stored.
- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` outside local development.
- Sessions last a fixed 12 hours from login, with no inactivity timeout and no last-seen tracking. The database sets `created_at` and `expires_at` and enforces the 12-hour duration with a `CHECK`; the application cannot choose a different expiry.
- Account lockout after 5 failures for 15 minutes; login rate limit of 10 per minute per IP.
- No two-factor authentication in Phase 1. Login is split into `verifyCredentials()` and `createSession()` so a two-factor step can be inserted later with approval.

Full flow: [authentication.md](../security/authentication.md).

## Consequences

- Login and logout are recorded exactly where they happen, which attendance requires.
- Sessions can be revoked instantly with a database update.
- No external identity provider or account is needed.
- We own security-critical code. It stays small and is covered by integration tests.
- A fixed session length may sign users out mid-task. This is accepted because an inactivity timeout would require activity tracking, which is forbidden.

## Alternatives rejected

- **Better Auth or Auth.js:** less direct control over the login and logout points; more dependency surface.
- **Hosted identity provider:** external service and data sharing; requires separate approval.
- **JWT access tokens:** cannot be revoked instantly without a server-side list, which is a session table anyway.
- **Inactivity timeout:** requires recording user activity.

Future single sign-on (Google Workspace or Microsoft through OIDC) is possible and needs separate approval.
