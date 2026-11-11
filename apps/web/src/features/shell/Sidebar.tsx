import type { NavSection } from "../../lib/navigation";
import styles from "./Shell.module.css";
import { SidebarNav } from "./SidebarNav";

export function Sidebar({ sections, open, id }: { sections: NavSection[]; open: boolean; id: string }) {
  return (
    <aside id={id} className={[styles.sidebar, open ? styles.sidebarOpen : undefined].filter(Boolean).join(" ")}>
      <div className={styles.workspace}>
        <span className={styles.workspaceMark} aria-hidden="true">
          C
        </span>
        CRM workspace
      </div>
      <SidebarNav sections={sections} />
    </aside>
  );
}
