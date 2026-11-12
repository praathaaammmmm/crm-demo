import { redirect } from "next/navigation";
import { LoginForm } from "../../../features/identity/LoginForm";
import styles from "../../../features/identity/Identity.module.css";
import { getSession } from "../../../lib/session";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.mustChangePassword ? "/change-password" : "/");

  return (
    <main className={styles.page}>
      <div className={styles.loginColumn}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">
            C
          </span>
          <span className={styles.identityName}>CRM workspace</span>
        </div>
        <div className={[styles.card, styles.loginCard].join(" ")}>
          <h1>Sign in</h1>
          <p className={styles.intro}>Internal workspace for the team.</p>
          <LoginForm />
        </div>
        <p className={styles.help}>Ask the CEO/CTO for access.</p>
      </div>
    </main>
  );
}
