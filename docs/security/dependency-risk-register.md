# Dependency Risk Register

Known vulnerabilities in installed dependencies that have been reviewed and accepted, with the reason and the condition for revisiting each one.

- **Decision owner:** CEO/CTO
- **Latest audit:** 2026-11-11, after removing `drizzle-kit` (`npm audit` against `registry.npmjs.org`; 311 dependencies: 111 production, 150 development, 78 optional)
- **Latest totals:** 10 moderate, 0 high, 0 critical, 0 low. All 10 come from one advisory, GHSA-g3hv-75wg-m249 (R-002). The other 9 entries are `eslint`, `@eslint/js`, `@eslint/config-array`, `typescript-eslint` and its `@typescript-eslint/*` packages, flagged only because they depend on the affected `minimatch`.

### Audit history

| Date | Totals | Advisories | Change |
|---|---|---|---|
| 2026-11-11 | 14 moderate | GHSA-67mh-4wv8-2f99 (esbuild ≤0.24.2 via `drizzle-kit`), GHSA-g3hv-75wg-m249 (`minimatch`) | Audit after Checkpoint 4 installation |
| 2026-11-11 | 10 moderate | GHSA-g3hv-75wg-m249 (`minimatch`) | `drizzle-kit` removed under the SQL-first migration policy; the esbuild advisory no longer applies |

## Accepted risks

### R-002: minimatch glob-pattern denial of service

| Field | Value |
|---|---|
| Advisory | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (npm advisory 1244623) |
| Severity | Moderate |
| Affected package | `minimatch` 10.2.6 (affected range: ≥7.0.0 <11.0.1) |
| Dependency paths | root devDependency `eslint` 10.14.0 → `minimatch` 10.2.6; `eslint` → `@eslint/config-array` 0.23.5 → `minimatch`; root devDependency `typescript-eslint` 8.72.2 → `@typescript-eslint/typescript-estree` 8.72.2 → `minimatch` |
| Status | Accepted, development-only |

**Why it is development-only:**

- `eslint` and `typescript-eslint` are devDependencies used only for linting. They are not part of the API, worker or web runtime.
- The glob patterns they evaluate come from the project's own ESLint configuration and file paths, not from users or external input.

**Why no forced remediation:**

- npm's suggested fix is downgrading `eslint` to 9.39.5 and `typescript-eslint` to 8.36.0, breaking downgrades that would undo the approved ESLint 10 configuration.
- Forcing `minimatch` 11 with an npm override would put a major-version jump under ESLint and typescript-eslint, which declare `minimatch` 10.

## Runtime dependencies

No advisories were reported for the packages the running application uses: `fastify`, `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, `pino`, `@node-rs/argon2`, `drizzle-orm`, `pg`, `zod`, `next`, `react`, `react-dom`.

## Review triggers

- Rerun `npm audit` before each future checkpoint and update this register with the date and result.
- Reconsider R-002 when `eslint` and `typescript-eslint` releases depend on `minimatch` ≥11.0.1.
- Reassess immediately if the advisory's severity increases, if a new advisory affects a runtime dependency, or if any affected package becomes part of the production runtime.

Any remediation that changes dependency versions, adds overrides, or downgrades packages requires explicit CEO/CTO approval.

## Prohibited without approval

- `npm audit fix` or `npm audit fix --force`
- npm `overrides` for these packages
- Downgrading `eslint` or `typescript-eslint`
