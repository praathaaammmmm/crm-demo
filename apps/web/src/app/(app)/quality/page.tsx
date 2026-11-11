import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { QualityOverview } from "../../../features/quality/QualityOverview";
import { canManageQuality, canSeeQuality } from "../../../lib/navigation";
import { requireAppSession } from "../../../lib/session";

export default async function QualityPage() {
  const { user } = await requireAppSession();
  return (
    <>
      <PageToolbar icon="gauge" title="Quality" />
      <PageContent>
        {canSeeQuality(user.role) ? <QualityOverview canManage={canManageQuality(user.role)} /> : <NotAllowed />}
      </PageContent>
    </>
  );
}
