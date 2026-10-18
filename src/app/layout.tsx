import type { Metadata } from "next";
import type { ReactNode } from "react";
import { currentUser } from "@/platform/auth";
import { AppShell } from "@/platform/ui/AppShell";
import "./globals.css";

export const metadata: Metadata = { title: "Internal Tools", robots: { index: false } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>{user ? <AppShell user={user}>{children}</AppShell> : children}</body>
    </html>
  );
}
