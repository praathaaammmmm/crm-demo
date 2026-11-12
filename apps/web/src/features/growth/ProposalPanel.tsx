import { formatInr, type Lead } from "@crm/contracts/growth-leads";
import { type ProposalDetail } from "@crm/contracts/growth-proposals";
import type { Role } from "@crm/permissions";
import { AcceptanceDrawer } from "./AcceptanceDrawer";
import styles from "./Growth.module.css";
import { ProposalActionDialog } from "./ProposalDialogs";
import { ProposalStatusPill } from "./ProposalStatusPill";
import { ProposalVersionDrawer } from "./ProposalVersionDrawer";
import { proposalActionsFor } from "../../lib/proposal-actions";

const safeHref = (value: string): string | null => {
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

export function ProposalPanel(props: {
  lead: Lead;
  detail: ProposalDetail;
  role: Role;
  nameOf: (id: string) => string;
  formatTime: (iso: string) => string;
}) {
  const { lead, detail } = props;
  const proposal = detail.proposal;
  const actions = proposalActionsFor({ role: props.role, lead, detail });
  if (!proposal) {
    return (
      <section className={styles.section} aria-labelledby="proposal-heading">
        <div className={styles.sectionHeader}><h2 id="proposal-heading" className={styles.sectionTitle}>Proposal</h2>{actions.canCreateVersion ? <ProposalVersionDrawer leadId={lead.id} proposal={null} /> : null}</div>
        <p className={styles.subtle}>No proposal has been created for this lead.</p>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="proposal-heading">
      <div className={styles.sectionHeader}>
        <h2 id="proposal-heading" className={styles.sectionTitle}>Proposal</h2>
        <span className={styles.actions}>
          <ProposalStatusPill status={proposal.status} />
          {actions.canCreateVersion ? <ProposalVersionDrawer leadId={lead.id} proposal={proposal} /> : null}
          {actions.canSubmit ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="submit" /> : null}
          {actions.canSend ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="sent" /> : null}
          {actions.canWithdraw ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="withdraw" /> : null}
          {actions.canAccept ? <AcceptanceDrawer proposal={proposal} /> : null}
          {actions.canMarkWon ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="won" /> : null}
          {actions.canApprove ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="approve" /> : null}
          {actions.canReject ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="reject" /> : null}
          {actions.canConfirm ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="confirm" /> : null}
          {actions.canRefuse ? <ProposalActionDialog leadId={lead.id} proposal={proposal} action="refuse" /> : null}
        </span>
      </div>
      {actions.waiting ? <p className={styles.notice} role="status">Waiting for CEO/CTO review.</p> : null}
      {actions.readOnly ? <p className={styles.subtle}>This proposal is final or the lead is read-only.</p> : null}
      <dl className={styles.proposalMeta}>
        <dt>Current version</dt><dd>v{proposal.currentVersionNo} · {formatInr(proposal.amountMinor)} · valid until {proposal.validUntil}</dd>
      </dl>
      <ol className={styles.proposalTimeline} aria-label="Proposal versions and events">
        {detail.versions.map((version) => {
          const document = safeHref(version.documentUrl);
          return <li key={version.id} className={styles.timelineItem}>
            <strong>Version {version.versionNo}</strong> <ProposalStatusPill status={version.status} />
            <span className={styles.subtle}>{formatInr(version.amountMinor)} · valid until {version.validUntil} · {props.nameOf(version.createdBy)} · {props.formatTime(version.createdAt)}</span>
            {document ? <a href={document} target="_blank" rel="noreferrer">Open proposal document</a> : null}
          </li>;
        })}
        {detail.events.map((event) => <li key={event.id} className={styles.timelineItem}><span>{event.fromStatus ?? "New"} → {event.toStatus}</span><span className={styles.subtle}>v{event.versionNo} · {props.nameOf(event.actorId)} · {props.formatTime(event.createdAt)}</span></li>)}
      </ol>
      {detail.acceptances.length > 0 ? <div className={styles.acceptances}>{detail.acceptances.map((acceptance) => {
        const evidence = acceptance.evidenceUrl ? safeHref(acceptance.evidenceUrl) : null;
        return <p key={acceptance.id}>v{acceptance.versionNo} accepted by {acceptance.method.replaceAll("_", " ")}{acceptance.needsConfirmation ? " · CEO confirmation required" : ""}{evidence ? <> · <a href={evidence} target="_blank" rel="noreferrer">Evidence</a></> : null}</p>;
      })}</div> : null}
    </section>
  );
}
