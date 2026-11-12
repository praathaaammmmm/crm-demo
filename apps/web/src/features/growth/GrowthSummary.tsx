import { growthOverviewSchema } from "@crm/contracts/growth-reports";
import Link from "next/link";
import { Panel, StatGrid } from "../../components/Insights";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import styles from "./Growth.module.css";
import { growthMetrics, PipelineBars } from "./GrowthOverview";

/** Home-page Growth panel for the CEO/CTO and the CGO: the default 90-day pipeline by stage plus headline counts. */
export async function GrowthSummary() {
  const data = dataOrForbidden(await serverGet("/growth/reports/overview", growthOverviewSchema));
  if (data === "forbidden") return null;
  return (
    <Panel id="growth-heading" title="Growth pipeline (last 90 days)" action={<Link href="/growth">View overview</Link>}>
      <StatGrid metrics={growthMetrics(data).primary} />
      <div className={styles.chartGap}>
        <PipelineBars data={data} />
      </div>
    </Panel>
  );
}
