import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sensitiv",
  description: "Location + requirements multi-source research assistant.",
};

// Placeholder shell. Section 9 replaces this with the next-intl (en/fr) layout.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
