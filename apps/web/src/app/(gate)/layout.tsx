import type { ReactNode } from "react";
import styles from "../../features/identity/Identity.module.css";
import { requireGateSession } from "../../lib/session";

/** Reachable only while a password change is pending; otherwise redirects to /login or /. */
export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireGateSession();
  return <main className={styles.page}>{children}</main>;
}
