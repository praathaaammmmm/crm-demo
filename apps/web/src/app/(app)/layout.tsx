import type { ReactNode } from "react";
import { AppShell } from "../../features/shell/AppShell";
import { navigationFor } from "../../lib/navigation";
import { requireAppSession } from "../../lib/session";

/** Every page here requires a session with no pending password change. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireAppSession();
  return (
    <AppShell user={session.user} sections={navigationFor(session.user.role)}>
      {children}
    </AppShell>
  );
}
