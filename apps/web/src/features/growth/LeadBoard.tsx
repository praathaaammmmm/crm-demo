import { GROWTH_STAGES, stageLabel, type Lead } from "@crm/contracts/growth-leads";
import Link from "next/link";
import styles from "./Growth.module.css";
import { OverdueBadge } from "./OverdueBadge";
import { OwnerFlag } from "./OwnerFlag";

/** One column per stage. Stage changes happen on the lead page, so every move records history and a note when needed. */
export function LeadBoard({ leads, companyOf }: { leads: Lead[]; companyOf: (id: string | null) => string }) {
  return (
    <div className={styles.board}>
      {GROWTH_STAGES.map((stage) => {
        const items = leads.filter((lead) => lead.stage === stage);
        return (
          <section key={stage} className={styles.column} aria-label={`${stageLabel(stage)} (${String(items.length)})`}>
            <h2 className={styles.sectionTitle}>
              {stageLabel(stage)} · {items.length}
            </h2>
            {items.map((lead) => (
              <article key={lead.id} className={styles.card}>
                <Link href={`/growth/leads/${lead.id}`} className={styles.titleLink}>
                  {lead.name}
                </Link>
                <span className={styles.subtle}>{companyOf(lead.companyId)}</span>
                <span className={styles.actions}>
                  <OverdueBadge overdue={lead.overdue} />
                  <OwnerFlag flagged={lead.ownerFlagged} />
                </span>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
