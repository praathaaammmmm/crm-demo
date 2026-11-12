# ADR 0010: Growth Reporting (Phase 4A.4)

- Status: Accepted
- Date: 2026-11-12

## Context

The CGO needs an operational view of the pipeline and the CEO/CTO a read-only overview, without new write paths, new permissions or a schema change.

## Decision

- One read-only endpoint, `GET /api/v1/growth/reports/overview?from&to`, gated by the existing `growth:read_all` (CEO/CTO and CGO). Every other role receives 403. Lead lists gain a `stale=true|false` filter.
- Dates are org-time-zone calendar days (`ORG_TIMEZONE`), inclusive. Default range: the 90 days ending today. Maximum 366 days; no future end date.
- **Live figures exclude archived leads:** open pipeline (count, estimated value, leads without a value), stage snapshot, overdue follow-ups, stale leads and the open columns of every breakdown.
- **Historical figures include archived leads:** won count and amount (`won_at` in range), lost count and reasons (`lost_at` in range), and the funnel.
- Lost means the lead is lost now. A reopened lead is not counted as lost; its history stays in `growth_stage_changes`.
- Win rate = won ÷ (won + lost) in the range; shown as "—" when nothing closed.
- Funnel: `new` counts leads created in the range; every other stage, `lost` included, counts distinct leads with a stage change into that stage in the range. The separate lost count and reasons (current lost state) are unchanged, so a lead that was lost and then reopened appears in the funnel's `lost` row but not in the lost count.
- **Stale:** an open, non-archived lead whose last touch is more than 14 days before today (exactly 14 days is not stale; 15 or more is). The last touch is the latest of creation, a stage change and a non-voided activity.
- Breakdowns by source (all eight, zero-filled), owner (with the existing "needs reassignment" flag) and company. Companies: the top ten by open value, then won amount, then one "No company" row, then everything else folded into "Other".
- All queries run in one read-only, repeatable-read transaction, so the figures are consistent. Existing indexes cover the filters. **No migration.**

## Privacy and audit

- The report contains counts, INR amounts, user ids, company ids/names and enum values only: no contact data, lead names, notes, links or activity text. The strict response schema rejects any extra field.
- Owner breakdowns are outcome data (leads, won, lost), visible to the CEO/CTO and the CGO only. No time-in-app, activity frequency or surveillance-style metric is computed.
- Reads are not audited, as everywhere else. There is no export or CSV.
- **O1 interaction:** the report does not change retention. A future redaction of contact data would not change any figure; deleting leads or activities would change historical figures. The O1 decision must say whether aggregates must survive deletion.
