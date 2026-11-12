# Growth CRM (Phase 4A)

Design decisions are recorded in [ADR 0008](../adrs/0008-growth-crm.md) and [ADR 0009](../adrs/0009-growth-proposals.md).

## Slice 4A.1: companies and contacts (implemented)

- The CGO adds, edits and archives companies (name, optional industry, https website, notes) and their contacts (name, role, email, phone, LinkedIn, website; at least one way to reach them).
- The CGO can mark a contact "do not contact".
- Archiving is final: an archived company and all its contacts become read-only, but stay visible.
- The CEO/CTO sees all companies and contacts read-only. No other role has access.
- Records owned by someone who is no longer an active CGO are flagged until the CEO/CTO reassigns them.
- No importing, scraping, messaging, export or search.

## Slice 4A.2: leads, pipeline and outreach activities (implemented, not yet browser-tested)

- The CGO creates leads (optionally linked to a company and its contact), edits them, moves them between open stages and marks them lost with a reason and note. Won is not available until proposals exist (4A.3).
- Every stage change is kept in the lead's stage history, including repeated moves back and forth.
- Only the CEO/CTO can reopen a lost lead or reassign a lead to another active CGO.
- The CGO logs outreach they did themselves (LinkedIn message, email, call, meeting, follow-up, other). Outbound needs a contact and is refused for do-not-contact contacts. An activity can be voided once, with a reason; it stays visible.
- Each lead can have a next follow-up date; leads past it are marked overdue. The board shows every stage; the list can be filtered by stage, overdue and archived.
- Company pages show the company's leads and activity.

## Slice 4A.3: proposals and approval (implemented)

- The CGO creates immutable proposal versions for an open lead, submits them for CEO/CTO approval, marks approved versions sent, records acceptance, withdraws active versions and explicitly marks an accepted lead won.
- The CEO/CTO approves or rejects submitted versions, and confirms or refuses verbal or late acceptances. Rejection, withdrawal and refusal need a note.
- Non-verbal acceptance requires an HTTPS evidence link. Verbal acceptance requires a note and, like late acceptance, waits for CEO/CTO confirmation before the lead can be won.
- Won is not a general stage move. It copies the accepted version's INR amount, currency and version into the lead and permanently freezes the lead.
- Proposal detail shows immutable versions and event history. `/growth/proposals` is available to CGO and CEO/CTO; `/growth/proposals/queue` is CEO/CTO-only.

## Slice 4A.4: dashboards and reporting (implemented)

- `/growth` is the CGO operational dashboard and the CEO/CTO read-only overview: open pipeline, overdue and stale (no touch for more than 14 days) leads, won/lost and win rate for a date range, stage snapshot, funnel, lost reasons, and breakdowns by owner, source and company.
- The range defaults to the last 90 days (at most 366, no future dates). Presets: last 30 days, last 90 days, quarter to date.
- Both home pages show four Growth tiles. Tiles link to filtered lead lists; the lead list has a Stale filter.
- Definitions, archived-lead rules and privacy notes: [ADR 0010](../adrs/0010-growth-reporting.md). No export.

## Screens

| Path | Who |
|---|---|
| `/growth` (overview) | CGO, CEO/CTO (read) |
| `/growth/companies` | CGO (manage), CEO/CTO (read) |
| `/growth/companies/[id]` | CGO (manage), CEO/CTO (read) |
| `/growth/leads` (board or list) | CGO (manage), CEO/CTO (read) |
| `/growth/leads/[id]` | CGO (manage), CEO/CTO (read, reopen, reassign) |
| `/growth/proposals` | CGO (read/manage), CEO/CTO (read) |
| `/growth/proposals/queue` | CEO/CTO (approve/confirm) |

## Open decision

- **O1 retention and redaction policy**: must be decided before Growth is used in production. It covers contact data, activity summaries and proof links, proposal documents, acceptance evidence links, and proposal/acceptance/confirmation notes.
- **O10 Neon verification gate**: no Growth migration is applied to Neon before Neon verification passes.
