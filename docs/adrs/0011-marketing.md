# ADR 0011: Marketing (Phase 4B)

- Status: Accepted
- Date: 2026-11-12

## Context

The CMO needs to plan campaigns and a LinkedIn/Instagram/YouTube content calendar, and the CEO/CTO needs to see progress, without uploads, platform APIs or new providers.

## Decision

- New permissions: `marketing:read_all` (CEO/CTO, CMO) and `marketing:manage` (CMO only). The CEO/CTO is read-only. Every other role receives 403.
- **Campaigns:** `draft → planned → active ⇄ paused → completed`, with `cancelled` from any unfinished status. Completed and cancelled campaigns are read-only and accept no new or re-linked content.
- **Content:** `draft → planned → in_review → published`; `in_review → planned` sends it back; `cancelled` from any unfinished status. Publishing requires an `https://` proof link to the live post and records the publish time; published content can only change its outcome counts; cancelled content is read-only.
- **Asset links:** label, kind and `https://` URL only. Links are added or removed (once), never edited or deleted. The server never fetches any link; there are no uploads.
- **Outcome reporting from internal records only:** content progress by status, reach/engagements/clicks the CMO records for published items, and on-time versus late publishing (published date in `ORG_TIMEZONE` versus planned date). The dashboard shows the next 14 days, overdue items (planned before today, not published or cancelled) and the last 30 days by channel.
- The contracts (`CONTENT_TRANSITIONS`, `CAMPAIGN_TRANSITIONS`) and database triggers (migration 0018) enforce the same rules. Grants (migration 0019) allow no DELETE or TRUNCATE; triggers refuse them for every role.

## Privacy and audit

- Audit events record ids, statuses, channels, dates, counts and changed-field flags only, never names, titles, objectives, briefs, labels or links.
- Marketing stores no personal data about audiences. Retention follows the general retention decision; nothing here adds cleanup.
