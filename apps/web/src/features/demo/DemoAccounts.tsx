import type { DemoAccount } from "@crm/contracts/demo";
import styles from "./Demo.module.css";

/** The public demo accounts. Fictional @example.test users; the API refuses every write. */
export function DemoAccounts({ accounts, password }: { accounts: readonly DemoAccount[]; password: string | null }) {
  return (
    <section className={styles.accounts} aria-labelledby="demo-accounts-title">
      <h2 id="demo-accounts-title">Demo accounts</h2>
      <p className={styles.accountsIntro}>
        Each role sees its own navigation and data.
        {password ? (
          <>
            {" "}
            Password for every account: <code>{password}</code>
          </>
        ) : null}
      </p>
      <ul>
        {accounts.map((account) => (
          <li key={account.email}>
            <span>{account.label}</span>
            <code>{account.email}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
