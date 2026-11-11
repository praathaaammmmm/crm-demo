import Link from "next/link";
import { EmptyState } from "./EmptyState";

export function NotAllowed() {
  return (
    <EmptyState title="You do not have access to this page">
      <Link href="/">Go to the home page</Link>
    </EmptyState>
  );
}
