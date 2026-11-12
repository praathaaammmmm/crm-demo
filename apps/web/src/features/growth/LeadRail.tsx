import { formatInr, stageLabel, type Lead, type StageChange } from "@crm/contracts/growth-leads";
import Link from "next/link";
import rail from "../tasks/Rail.module.css";
import styles from "./Growth.module.css";
import { OverdueBadge } from "./OverdueBadge";
import { OwnerFlag } from "./OwnerFlag";

/** Lead details and its full stage history (oldest first, one entry per revision). */
export function LeadRail(props: {
  lead: Lead;
  history: StageChange[];
  nameOf: (id: string) => string;
  companyName: string | null;
  contactName: string | null;
  formatTime: (iso: string) => string;
}) {
  const { lead } = props;
  return (
    <div className={rail.panel}>
      <dl className={rail.meta}>
        <dt>Company</dt>
        <dd>{lead.companyId && props.companyName ? <Link href={`/growth/companies/${lead.companyId}`}>{props.companyName}</Link> : "—"}</dd>
        <dt>Primary contact</dt>
        <dd>{props.contactName ?? "—"}</dd>
        <dt>Owner</dt>
        <dd className={styles.actions}>
          {props.nameOf(lead.ownerId)}
          <OwnerFlag flagged={lead.ownerFlagged} />
        </dd>
        <dt>Priority</dt>
        <dd>{lead.priority}</dd>
        <dt>Value</dt>
        <dd>{lead.estimatedValueMinor === null ? "—" : formatInr(lead.estimatedValueMinor)}</dd>
        <dt>Expected close</dt>
        <dd>{lead.expectedCloseOn ?? "—"}</dd>
        <dt>Next follow-up</dt>
        <dd className={styles.actions}>
          {lead.nextFollowUpOn ?? "—"}
          <OverdueBadge overdue={lead.overdue} />
        </dd>
        {lead.stage === "lost" ? (
          <>
            <dt>Lost because</dt>
            <dd className={rail.description}>{lead.lostNote ?? "—"}</dd>
          </>
        ) : null}
      </dl>
      <h2 className={styles.sectionTitle}>Stage history</h2>
      {props.history.length === 0 ? (
        <p className={styles.subtle}>Still in New.</p>
      ) : (
        <ol className={styles.history} aria-label="Stage history">
          {props.history.map((change) => (
            <li key={change.id}>
              {stageLabel(change.fromStage)} → {stageLabel(change.toStage)}
              <span className={styles.subtle}>
                {" "}
                · {props.nameOf(change.actorId)} · {props.formatTime(change.createdAt)}
              </span>
              {change.note ? <p className={styles.summary}>{change.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
