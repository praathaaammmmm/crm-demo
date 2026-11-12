import { notificationPageSchema } from "@crm/contracts/notifications";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { MarkAllReadButton } from "../../../features/notifications/NotificationActions";
import { NotificationList } from "../../../features/notifications/NotificationList";
import { orgTimeZone } from "../../../lib/org-time";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

export default async function NotificationsPage() {
  await requireAppSession();
  const page = dataOrForbidden(await collectPages("/notifications", notificationPageSchema));
  const hasUnread = page !== "forbidden" && page.items.some((notification) => notification.readAt === null);
  return (
    <>
      <PageToolbar icon="bell" title="Notifications" primaryAction={hasUnread ? <MarkAllReadButton /> : undefined} />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.notifications} />
            {page.items.length === 0 ? (
              <EmptyState title="No notifications yet">Meeting reminders appear here 10, 5 and 2 minutes before a meeting starts.</EmptyState>
            ) : (
              <NotificationList notifications={page.items} timeZone={orgTimeZone()} />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
