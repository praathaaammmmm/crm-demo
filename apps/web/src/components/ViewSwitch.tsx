import Link from "next/link";
import { Icon } from "./Icon";
import styles from "./Toolbar.module.css";

/** Board/List switch. Links, so the view is shareable and works without JavaScript. */
export function ViewSwitch({ current, hrefFor }: { current: "board" | "list"; hrefFor: (view: "board" | "list") => string }) {
  return (
    <nav aria-label="View" className={styles.switch}>
      {(["board", "list"] as const).map((view) => (
        <Link key={view} href={hrefFor(view)} className={styles.switchItem} aria-current={view === current ? "page" : undefined}>
          <Icon name={view} />
          {view === "board" ? "Board" : "List"}
        </Link>
      ))}
    </nav>
  );
}
