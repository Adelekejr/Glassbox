import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Glassbox",
  description: "Read-only auditor for AI agents on NEAR.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
