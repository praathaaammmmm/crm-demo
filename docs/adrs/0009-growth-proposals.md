# ADR 0009: Growth Proposals (Phase 4A.3)

- Status: Accepted
- Date: 2026-11-12

## Context

Growth needs a reviewable commercial workflow without turning the CRM into an outbound-messaging system or coupling won deals to Phase 8 delivery. A proposal must retain its full decision history, the CEO/CTO must approve commercial decisions, and a won lead must be final.

## Decision

### Workflow and roles

- A lead has at most one proposal cache and an ordered series of immutable versions. The CGO creates a version, submits a draft, sends an approved version, withdraws an active version, records acceptance, and explicitly marks an accepted lead won.
- The CEO/CTO alone holds `growth:approve_proposals`: approve/reject a submitted version and confirm/refuse an acceptance that requires confirmation. Rejection, withdrawal and refusal require a note. No other role receives proposal actions.
- A non-verbal acceptance needs an HTTPS evidence link. A verbal acceptance needs a note. Verbal or late acceptance enters `acceptance_pending` and cannot win until the CEO/CTO confirms it; refusal leaves the version `acceptance_refused`, from which the CGO may create a replacement draft.
- A lead becomes `won` only through the explicit CGO mark-won action for its current accepted version. The database derives `won_at`, INR amount and currency from that version, stores `won_version_id` with the stage change, and appends matching stage history and `accepted → won` proposal event in the same transaction. A won lead, its proposal cache, versions and acceptance records are permanently frozen.

### Immutable model and cache

- Proposal versions, events, acceptances and confirmations are append-only for every role, including `crm_migrator`; UPDATE, DELETE and TRUNCATE are refused.
- The first version creates one `NULL → draft` event. Replacing a draft first creates `draft → superseded`, then the new version's `NULL → draft` event. The cache always reflects the most recent immutable event.
- `growth_proposals` is a cache, not an application-owned record. Its insert/update trigger refuses direct DML at trigger depth 1; only nested proposal-trigger execution (`pg_trigger_depth() > 1`) may create or advance it. Transaction-local configuration, including the retired bypass setting, is not consulted. Internal transitions are trigger-only; user transitions are direct API inserts with role and current-version checks.

### Phase 8 boundary

`wonLeadsForConversion()` is the only approved Growth read boundary for Phase 8. It returns won leads only, in stable `(wonAt, id)` cursor order. It is read-only: it creates no clients, projects or outbox events and does not mutate Growth data. Phase 8 will copy selected data into its own client records rather than reusing Growth rows.

### Privacy, audit and deployment gates

- Proposal documents, acceptance evidence links, summaries and notes remain in their own protected Growth records. Audit events contain only safe metadata such as version number, status, method, decision and identifiers; they never contain proposal links, evidence links, summaries or notes.
- **O1 retention/redaction:** the Growth retention/redaction decision applies to proposal links, evidence and notes as well as contact and activity data. No cleanup, anonymisation or export is implemented until an approved policy defines it.
- **O10 Neon gate:** no Growth migration, including 4A.3 migrations 0016 and 0017, may be applied to Neon before Neon verification passes. Local throwaway/test-template validation remains the only approved migration target until then.

## Consequences

- Migrations 0016 and 0017 add the proposal model and least-privilege grants.
- Proposal cache writes are intentionally unavailable to `crm_app`; it writes only the allowlisted input columns of versions, events, acceptances and confirmations. `crm_worker` has no proposal-table access.
- The web exposes proposal detail, a CGO/CEO action panel, a proposal list and a CEO-only approval queue. UI visibility is advisory; API policy and database constraints remain authoritative.
