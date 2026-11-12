import { PageContent, PageToolbar } from "../../components/PageToolbar";
import { CeoDashboard } from "../../features/dashboard/CeoDashboard";
import { WelcomePanel } from "../../features/dashboard/WelcomePanel";
import { GrowthSummary } from "../../features/growth/GrowthSummary";
import { MarketingTiles } from "../../features/marketing/MarketingTiles";
import { OperationsTiles } from "../../features/operations/OperationsTiles";
import { MeetingsSection } from "../../features/meetings/MeetingsSection";
import { OpenDefectsTile } from "../../features/quality/OpenDefectsTile";
import { QualityOverview } from "../../features/quality/QualityOverview";
import { canDecideApprovals, canManageQuality, canSeeDefects, canSeeGrowth, canSeeMarketing, canSeeMeetings, canSeeOperations, canSeeQuality, navItemsFor } from "../../lib/navigation";
import { requireAppSession } from "../../lib/session";
import styles from "../../features/dashboard/Dashboard.module.css";

export default async function HomePage() {
  const { user } = await requireAppSession();
  const isCeo = canDecideApprovals(user.role);
  return (
    <>
      <PageToolbar icon="home" title={isCeo ? "Dashboard" : "Home"} />
      <PageContent>
        {isCeo ? (
          <CeoDashboard />
        ) : (
          <div className={styles.stack}>
            <WelcomePanel name={user.name} items={navItemsFor(user.role)} />
            {canSeeGrowth(user.role) ? (
              <GrowthSummary />
            ) : null}
            {canSeeMarketing(user.role) ? (
              <MarketingTiles />
            ) : null}
            {canSeeOperations(user.role) ? (
              <OperationsTiles />
            ) : null}
            {canSeeMeetings(user.role) ? (
              <MeetingsSection summary={false} />
            ) : null}
            {/* VP Engineering & Quality sees quality tiles; other roles with tasks see their open defects. */}
            <div className={styles.stack}>
              {canSeeQuality(user.role) ? (
                <QualityOverview canManage={canManageQuality(user.role)} previewRows={5} />
              ) : canSeeDefects(user.role) ? (
                <OpenDefectsTile />
              ) : null}
            </div>
          </div>
        )}
      </PageContent>
    </>
  );
}
