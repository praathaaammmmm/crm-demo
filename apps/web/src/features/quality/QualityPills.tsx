import {
  defectStatusLabel,
  qaOutcomeLabel,
  readinessLabel,
  severityLabel,
  type DefectSeverity,
  type DefectStatus,
  type QaOutcome,
  type ReleaseReadiness,
} from "@crm/contracts/quality";
import styles from "./Quality.module.css";

function Pill({ tone, label }: { tone: string | undefined; label: string }) {
  return (
    <span className={[styles.pill, tone].filter(Boolean).join(" ")}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}

const SEVERITY_TONE: Record<DefectSeverity, string | undefined> = {
  critical: styles.critical,
  high: styles.danger,
  medium: styles.warning,
  low: styles.neutral,
};

const STATUS_TONE: Record<DefectStatus, string | undefined> = {
  open: styles.warning,
  in_progress: styles.info,
  fixed: styles.review,
  verified: styles.success,
  wont_fix: styles.neutral,
};

const OUTCOME_TONE: Record<QaOutcome, string | undefined> = {
  passed: styles.success,
  failed: styles.danger,
  blocked: styles.warning,
};

const READINESS_TONE: Record<ReleaseReadiness, string | undefined> = {
  not_ready: styles.danger,
  at_risk: styles.warning,
  ready: styles.success,
};

export const SeverityPill = ({ severity }: { severity: DefectSeverity }) => (
  <Pill tone={SEVERITY_TONE[severity]} label={severityLabel(severity)} />
);

export const DefectStatusPill = ({ status }: { status: DefectStatus }) => (
  <Pill tone={STATUS_TONE[status]} label={defectStatusLabel(status)} />
);

/** A check with no result yet shows "Not run". */
export const QaOutcomePill = ({ outcome }: { outcome: QaOutcome | null }) =>
  outcome === null ? <Pill tone={styles.neutral} label="Not run" /> : <Pill tone={OUTCOME_TONE[outcome]} label={qaOutcomeLabel(outcome)} />;

export const ReadinessPill = ({ readiness }: { readiness: ReleaseReadiness }) => (
  <Pill tone={READINESS_TONE[readiness]} label={readinessLabel(readiness)} />
);
