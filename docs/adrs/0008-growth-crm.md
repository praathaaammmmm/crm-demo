# ADR 0008: Growth CRM (Phase 4A)

- Status: Accepted (slices 4A.1–4A.3 implemented; 4A.4 planned)
- Date: 2026-11-12

## Context

The CGO needs an internal CRM for companies, contacts, leads, outreach, a sales pipeline and proposals. The CEO/CTO needs oversight without becoming a second operator. Contacts are personal data about people outside the organisation. Won deals must later become clients in Phase 8 without coupling Growth to delivery.

## Decision

### Access

- Only existing roles are used. `cgo` gets `growth:read_all`, `growth:read_contacts` and `growth:manage`. `ceo_cto` gets `growth:read_all`, `growth:read_contacts`, `growth:reassign`, `growth:reopen` and `growth:approve_proposals`. Every other role has no Growth permission (403).
- The API follows the repository's resource-id convention: missing endpoint permission → 403 (checked first); malformed id → 404; well-formed missing or invisible record → 404; invalid query or body → 400; conflicts → 409.

### Ownership

- Every company and contact has `owner_id NOT NULL` and `owner_is_super_admin boolean NOT NULL DEFAULT false` with `CHECK (owner_is_super_admin = false)` and a `MATCH FULL` composite foreign key to `users (id, is_super_admin)`: the CEO/CTO can never own Growth records, and an owner can never be partly null.
- Trigger `growth_owner_guard()` allows assigning an owner (insert, or a change of `owner_id`) only when that user is active and has role `cgo`. Updates that keep the owner are not checked, so a later role change or deactivation of the CGO is never blocked; their records remain editable and are flagged (`ownerFlagged`) until the CEO/CTO reassigns them (slice 4A.2).

### Data rules

- Company names and contact names are stored normalised (trimmed, internal whitespace collapsed), enforced by `CHECK`s, so spacing cannot bypass length or uniqueness. Company names are unique case-insensitively among non-archived companies. Industry is optional free text, trimmed, at most 100 characters.
- Every contact needs a name and at least one contact method (email, phone, LinkedIn URL or website URL). Links are https only; LinkedIn links must be linkedin.com links.
- Records are archived, never deleted. Database triggers make archived companies read-only (including un-archiving), forbid inserting or changing contacts of an archived company, and make archived contacts read-only. The contact guard reads the parent with `FOR SHARE`, so a concurrent company archive is either seen or waited for. Reads are unaffected.
- `do_not_contact` is a flag on the contact. From slice 4A.2, outbound activities must name a contact, and a trigger refuses outbound activities to do-not-contact, archived or other-company contacts.

### Privacy

Contact details are visible only with `growth:read_contacts` and never appear in audit events or logs. There is no export. A contact retention and redaction policy is an open decision that must be made before production use; no anonymisation feature is built until then.

### Leads, stage history and activities (slice 4A.2)

- One `growth_leads` row moves through `new → contacted → qualified → proposal → negotiation → won | lost`. A lead may link a company and a primary contact; a composite foreign key `(primary_contact_id, company_id) → growth_contacts (id, company_id)` keeps them consistent. Values are whole INR in paise (`0 … 10^11`), `currency` is fixed to `INR`.
- **Stage revisions.** `stage_revision` starts at 0 in `new` on insert (the insert trigger forces both) and is set by trigger to old + 1 on every stage change; changing it without a stage change is refused. Each change needs one `growth_stage_changes` row with the same lead, revision, from and to stages, inserted in the same transaction (an insert trigger checks it matches the lead's current revision; `UNIQUE (lead_id, stage_revision)`). A deferred constraint trigger checks at commit that the history row for every revision exists, so a missing row rolls the whole transaction back. Repeated transitions such as `new → contacted → new → contacted → new` are four revisions with four rows.
- **Won** is refused by a `CHECK` until slice 4A.3 adds proposals. **Lost** needs a reason and a note. A lost lead is read-only for the CGO except archiving; only the CEO/CTO (`growth:reopen`) can reopen it to an open stage, with a note. Archived leads are read-only for everyone.
- **Reassignment.** Only the CEO/CTO (`growth:reassign`) changes a lead's owner, and only to an active CGO (`growth_owner_guard()`). This clears `ownerFlagged`.
- **Follow-ups.** `next_follow_up_on` is a date that cannot be set in the past (organisation time zone, `ORG_TIMEZONE`). A lead is overdue from the day after that date while it is open and not archived.
- **Activities** record manual outreach only; the CRM sends nothing. Every activity links a lead, company or contact. Outbound always needs a contact (`CHECK`). The trigger `growth_activities_link_guard()` derives `company_id` from the lead or contact, refuses links that disagree, allows a lead without a company only inbound activity without a contact, and refuses archived links and outbound activity to do-not-contact contacts (reading the contact `FOR SHARE`). Activities are never edited or deleted; the CGO can void one once, with a reason, and it stays visible.
- Stage history is append-only for every role (triggers refuse UPDATE, DELETE and TRUNCATE, including for `crm_migrator`).

### Proposals and won deals (slice 4A.3)

Proposal workflow, append-only records, CEO approval, acceptance evidence and the explicit CGO mark-won action are accepted in [ADR 0009](0009-growth-proposals.md). `won` is no longer a general stage move: a current accepted proposal version is required, and a won lead is permanently final.

### Phase 8 boundary

Phase 8 copies, rather than reuses, Growth data: it creates its own client (and selected client contacts) from a won lead with immutable `source_lead_id` (unique), `source_company_id` and `source_proposal_version_id`. Growth exposes the read-only `wonLeadsForConversion()` boundary from slice 4A.3.

## Consequences

- Migrations 0012 (schema, owner and archive guards) and 0013 (grants) for slice 4A.1; schema and grants stay paired in each later slice.
- Growth migrations are applied only to the local test template until Neon verification passes; this includes the O10 gate for migrations 0016 and 0017.
