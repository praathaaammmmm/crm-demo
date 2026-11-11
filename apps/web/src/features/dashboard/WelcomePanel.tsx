import Link from "next/link";
import { Icon } from "../../components/Icon";
import type { NavItem } from "../../lib/navigation";
import styles from "./Dashboard.module.css";

/** Home for everyone except the CEO/CTO: links only to areas their role may use. */
export function WelcomePanel({ name, items }: { name: string; items: NavItem[] }) {
  const areas = items.filter((item) => item.href !== "/");
  return (
    <div className={styles.welcome}>
      <h2>Welcome, {name}</h2>
      {areas.length > 0 ? (
        <ul className={styles.links}>
          {areas.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={styles.linkItem}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.label}>Your assigned work will appear here.</p>
      )}
    </div>
  );
}
