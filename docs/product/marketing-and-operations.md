# Marketing and Engineering Operations (Phases 4B and 4C)

## Marketing (CMO; CEO/CTO read-only)

- Campaigns with objectives, dates and a lifecycle; content planned per channel (LinkedIn, Instagram, YouTube) on a calendar.
- Content goes through review to published with a proof link; outcome counts are recorded by hand after publishing.
- Asset links (no uploads) on each content item.
- `/marketing` dashboard: active campaigns, next 14 days, overdue, in review, last 30 days by channel. The CMO and CEO/CTO home pages show the same tiles.
- Rules and privacy: [ADR 0011](../adrs/0011-marketing.md).

## Engineering Operations (VP Engineering & Quality; CEO/CTO reads and approves)

- Incidents with severity, owner, timeline, resolution and a post-incident note.
- Release records with checklists, CEO/CTO approval for production, outcome and rollback records. Nothing deploys.
- Automation registry with a lifecycle, CEO/CTO go-live approval, recorded runs and health. Nothing executes.
- `/operations` dashboard: open incidents by severity, approvals waiting, unhealthy live automations, last-30-day deployments and rollbacks. The VP and CEO/CTO home pages show the same tiles.
- Rules and privacy: [ADR 0012](../adrs/0012-engineering-operations.md).

## Screens

| Path | Who |
|---|---|
| `/marketing`, `/marketing/campaigns`, `/marketing/campaigns/[id]`, `/marketing/content`, `/marketing/content/[id]` | CMO (manage), CEO/CTO (read) |
| `/operations`, `/operations/incidents[/id]`, `/operations/releases[/id]`, `/operations/automations[/id]` | VP (manage), CEO/CTO (read, approve) |
