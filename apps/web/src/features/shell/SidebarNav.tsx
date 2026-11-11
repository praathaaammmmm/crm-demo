"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../../components/Icon";
import type { NavSection } from "../../lib/navigation";
import styles from "./Shell.module.css";

/** Shows only the areas the user's role may use. The API still enforces every permission. */
export function SidebarNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Main">
      {sections.map((section) => (
        <div key={section.title} className={styles.section}>
          <span className={styles.sectionTitle}>{section.title}</span>
          {section.items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navLink}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
