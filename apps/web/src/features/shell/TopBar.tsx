import type { SessionResponse } from "@crm/contracts/identity";
import { Avatar } from "../../components/Avatar";
import { IconButton } from "../../components/IconButton";
import { roleLabel } from "../../lib/navigation";
import { LogoutButton } from "../identity/LogoutButton";
import styles from "./Shell.module.css";

export function TopBar({
  user,
  menuOpen,
  onToggleMenu,
  sidebarId,
}: {
  user: SessionResponse["user"];
  menuOpen: boolean;
  onToggleMenu: () => void;
  sidebarId: string;
}) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        <IconButton
          icon="menu"
          label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls={sidebarId}
          className={styles.menuButton}
          onClick={onToggleMenu}
        />
        <span>Internal workspace</span>
      </div>
      <div className={styles.user}>
        <Avatar name={user.name} />
        <span className={styles.userText}>
          <span>{user.name}</span>
          <span className={styles.userRole}>{roleLabel(user.role)}</span>
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}
