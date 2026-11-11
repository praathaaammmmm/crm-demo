import Link from "next/link";
import { EmptyState } from "../components/EmptyState";

export default function NotFound() {
  return (
    <main style={{ padding: "var(--space-8) var(--space-4)", maxWidth: 640, margin: "0 auto" }}>
      <EmptyState title="Page not found">
        <Link href="/">Go to the home page</Link>
      </EmptyState>
    </main>
  );
}
