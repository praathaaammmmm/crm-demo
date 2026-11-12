# ADR 0012: Engineering Operations (Phase 4C)

- Status: Accepted
- Date: 2026-11-12

## Context

The VP Engineering & Quality needs records for incidents, releases and automations, and AGENTS.md requires CEO approval for sensitive deployment actions. The CRM must not deploy, run or call anything.

## Decision

- New permissions: `operations:read_all` (CEO/CTO, VP), `operations:manage` (VP only) and `operations:approve` (CEO/CTO only). Every other role receives 403.
- **Incidents:** severity `sev1`–`sev4`, an active owner, `open → investigating ⇄ mitigated → resolved` (open may jump to mitigated or resolved). Resolving needs a resolution summary. Status changes and notes append to an immutable timeline. After resolution, the only change is a single post-incident note.
- **Releases (records only):** a checklist that must be non-empty and fully ticked before a release leaves draft; items change only while the release is a draft. Production: `draft → awaiting_approval → approved | rejected` (CEO/CTO decides; rejection needs a note; `rejected → draft` for rework) `→ deployed | failed` (VP records the outcome). Staging records `deployed | failed` directly from draft. A rollback record (`deployed | failed → rolled_back`) needs a note. Every change appends an immutable decision row.
- **Automation registry (records only):** `draft ⇄ testing → awaiting_approval → live ⇄ paused`, `retired` from any other status and final. Going live is a CEO/CTO decision (`operations:approve`), as is sending it back to testing (with a note). Only draft or testing automations can be edited. Lifecycle changes append immutable rows.
- **Runs:** the VP records start, finish, outcome and, for failures only, a one-line error summary of at most 300 characters. The API refuses summaries containing links, key/value secrets, bearer tokens or stack frames; the database refuses links and line breaks. Runs are append-only and accepted only for testing, live or paused automations. Health comes from the five latest runs: none → unknown, latest failed → failing, any failure → degraded, otherwise healthy.
- Migration 0020 enforces the same transition pairs, checklist completeness and append-only histories for every role; migration 0021 grants SELECT and column-limited INSERT/UPDATE to `crm_app` only, with no DELETE.

## Assumptions

- Automation go-live uses the same CEO/CTO approval as production releases, because AGENTS.md requires CEO approval for high-risk changes and the lifecycle includes `awaiting_approval`.
- Database triggers check transition pairs; the policy layer checks which role may take each step.

## Privacy and audit

- Audit events record ids, statuses, severities, environments, outcomes and changed-field flags; never titles, notes, resolutions, post-incident notes, purposes or error summaries.
- No personal monitoring: incident owners and actors are recorded, nothing else about people.
