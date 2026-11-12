import { stageLabel, type GrowthStage } from "@crm/contracts/growth-leads";
import styles from "./Growth.module.css";

const TONE: Record<GrowthStage, string | undefined> = {
  new: styles.stageNew,
  contacted: styles.stageActive,
  qualified: styles.stageActive,
  proposal: styles.stageActive,
  negotiation: styles.stageActive,
  won: styles.stageWon,
  lost: styles.stageLost,
};

export function StagePill({ stage }: { stage: GrowthStage }) {
  return <span className={[styles.badge, TONE[stage]].join(" ")}>{stageLabel(stage)}</span>;
}
