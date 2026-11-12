import { meetingPageSchema, meetingSummarySchema } from "@crm/contracts/meetings";
import Link from "next/link";
import { NotAllowed } from "../../components/NotAllowed";
import { orgTimeZone } from "../../lib/org-time";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import dashboard from "../dashboard/Dashboard.module.css";
import { MeetingCard } from "./MeetingCard";
import { MeetingSummaryTiles } from "./MeetingSummaryTiles";
import styles from "./Meetings.module.css";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dashboard section. The CEO sees exact summary counts and the next five meetings; everyone else sees
 * their next three meetings in the coming week.
 */
export async function MeetingsSection({ summary }: { summary: boolean }) {
  const timeZone = orgTimeZone();
  let tiles = null;
  let next;
  if (summary) {
    const result = dataOrForbidden(await serverGet("/meetings/summary", meetingSummarySchema));
    if (result === "forbidden") return <NotAllowed />;
    tiles = <MeetingSummaryTiles counts={result.counts} />;
    next = result.next;
  } else {
    const now = Date.now();
    const page = dataOrForbidden(
      await serverGet("/meetings", meetingPageSchema, {
        from: new Date(now).toISOString(),
        to: new Date(now + WEEK_MS).toISOString(),
        status: "scheduled",
        limit: "3",
      }),
    );
    if (page === "forbidden") return null;
    next = page.items;
  }

  return (
    <section className={dashboard.section} aria-labelledby="meetings-heading">
      <div className={dashboard.sectionHeader}>
        <h2 id="meetings-heading" className={dashboard.sectionTitle}>
          {summary ? "Meetings" : "Your next meetings"}
        </h2>
        <Link href="/meetings">View all</Link>
      </div>
      {tiles}
      <div style={{ marginTop: tiles ? "var(--space-3)" : 0 }}>
        {next.length === 0 ? (
          <p className={dashboard.previewEmpty}>No upcoming meetings.</p>
        ) : (
          <ul className={styles.list}>
            {next.map((meeting) => (
              <li key={meeting.id}>
                <MeetingCard meeting={meeting} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
