import { redirect } from "next/navigation";
import { LoginForm } from "../../../features/identity/LoginForm";
import styles from "../../../features/identity/Identity.module.css";
import { getSession } from "../../../lib/session";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.mustChangePassword ? "/change-password" : "/");

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Sign in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
