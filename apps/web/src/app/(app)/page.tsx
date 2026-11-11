import { PageContent, PageToolbar } from "../../components/PageToolbar";
import { CeoDashboard } from "../../features/dashboard/CeoDashboard";
import { WelcomePanel } from "../../features/dashboard/WelcomePanel";
import { OpenDefectsTile } from "../../features/quality/OpenDefectsTile";
import { QualityOverview } from "../../features/quality/QualityOverview";
import { canDecideApprovals, canManageQuality, canSeeDefects, canSeeQuality, navItemsFor } from "../../lib/navigation";
import { requireAppSession } from "../../lib/session";

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
          <>
            <WelcomePanel name={user.name} items={navItemsFor(user.role)} />
            {/* VP Engineering & Quality sees quality tiles; other roles with tasks see their open defects. */}
            <div style={{ marginTop: "var(--space-6)" }}>
              {canSeeQuality(user.role) ? (
                <QualityOverview canManage={canManageQuality(user.role)} previewRows={5} />
              ) : canSeeDefects(user.role) ? (
                <OpenDefectsTile />
              ) : null}
            </div>
          </>
        )}
      </PageContent>
    </>
  );
}
