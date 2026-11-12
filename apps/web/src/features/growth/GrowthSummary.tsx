import { growthOverviewSchema } from "@crm/contracts/growth-reports";
import Link from "next/link";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import dashboard from "../dashboard/Dashboard.module.css";
import { GrowthTiles } from "./GrowthOverview";

/** Home-page Growth section for the CEO/CTO and the CGO: the default 90-day overview as four tiles. */
export async function GrowthSummary() {
  const data = dataOrForbidden(await serverGet("/growth/reports/overview", growthOverviewSchema));
  if (data === "forbidden") return null;
  return (
    <section className={dashboard.section} aria-labelledby="growth-heading">
      <div className={dashboard.sectionHeader}>
        <h2 id="growth-heading" className={dashboard.sectionTitle}>
          Growth (last 90 days)
        </h2>
        <Link href="/growth">View overview</Link>
      </div>
      <GrowthTiles data={data} compact />
    </section>
  );
}
