import { ChangePasswordForm } from "../../../features/identity/ChangePasswordForm";
import { LogoutButton } from "../../../features/identity/LogoutButton";
import styles from "../../../features/identity/Identity.module.css";

export default function ChangePasswordPage() {
  return (
    <div className={styles.card}>
      <h1>Choose a new password</h1>
      <p className={styles.intro}>You signed in with a temporary password. Choose your own before continuing.</p>
      <ChangePasswordForm />
      <div className={styles.footer}>
        <LogoutButton />
      </div>
    </div>
  );
}
