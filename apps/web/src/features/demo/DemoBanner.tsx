import { DEMO_BANNER_TEXT } from "@crm/contracts/demo";
import styles from "./Demo.module.css";

export function DemoBanner() {
  return (
    <div className={styles.banner} role="status">
      <strong>{DEMO_BANNER_TEXT}</strong>
      <span className={styles.bannerDetail}>Fictional company and people. This public demo is read-only.</span>
    </div>
  );
}
