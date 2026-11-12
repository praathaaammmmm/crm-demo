import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DemoBanner } from "../features/demo/DemoBanner";
import { isDemoMode } from "../lib/demo";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {isDemoMode() ? <DemoBanner /> : null}
        {children}
      </body>
    </html>
  );
}
