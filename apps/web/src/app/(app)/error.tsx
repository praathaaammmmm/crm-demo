"use client";

import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageContent } from "../../components/PageToolbar";

/** Shown when a page's data could not be loaded. Never displays error details. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContent>
      <ErrorNotice message="Something went wrong while loading this page." />
      <Button
        onClick={() => {
          reset();
        }}
      >
        Try again
      </Button>
    </PageContent>
  );
}
