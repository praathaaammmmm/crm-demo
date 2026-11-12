import { redirect } from "next/navigation";
import { DemoAccounts } from "../../../features/demo/DemoAccounts";
import { LoginForm } from "../../../features/identity/LoginForm";
import styles from "../../../features/identity/Identity.module.css";
import { demoLogin } from "../../../lib/demo";
import { getSession } from "../../../lib/session";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.mustChangePassword ? "/change-password" : "/");
  const demo = demoLogin();

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
          <p className={styles.intro}>{demo ? "Public demo workspace with fictional data." : "Internal workspace for the team."}</p>
          <LoginForm />
          {demo ? <DemoAccounts accounts={demo.accounts} password={demo.password} /> : null}
        </div>
        {demo ? null : <p className={styles.help}>Ask the CEO/CTO for access.</p>}
      </div>
    </main>
  );
}
