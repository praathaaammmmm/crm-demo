"use client";

import type { SessionResponse } from "@crm/contracts/identity";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { NavSection } from "../../lib/navigation";
import styles from "./Shell.module.css";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/** 236px sidebar, 52px top bar, page content. Below 1024px the sidebar becomes an off-canvas panel. */
export function AppShell({
  user,
  sections,
  children,
}: {
  user: SessionResponse["user"];
  sections: NavSection[];
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const sidebarId = useId();

  // Close the mobile navigation after navigating.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className={styles.shell}>
      <Sidebar sections={sections} open={menuOpen} id={sidebarId} />
      {menuOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
      <TopBar
        user={user}
        menuOpen={menuOpen}
        sidebarId={sidebarId}
        onToggleMenu={() => {
          setMenuOpen((open) => !open);
        }}
      />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
