"use client";

import { unreadCountSchema } from "@crm/contracts/notifications";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { apiRequest } from "../../lib/api-client";
import styles from "./Notifications.module.css";

const POLL_MS = 30_000;

/**
 * Unread reminder count. Reads the count on navigation and every 30 seconds while the tab is visible.
 * It only reads a number: no activity is recorded.
 */
export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void apiRequest("/notifications/unread-count", unreadCountSchema).then((result) => {
        if (active && result.ok) setCount(result.data.count);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname]);

  const unread = count ?? 0;
  return (
    <Link href="/notifications" className={styles.bell} aria-label={unread > 0 ? `Notifications, ${String(unread)} unread` : "Notifications"}>
      <Icon name="bell" />
      {unread > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {unread > 99 ? "99+" : String(unread)}
        </span>
      ) : null}
    </Link>
  );
}
