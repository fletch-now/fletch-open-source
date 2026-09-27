import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/dashboard/app-shell";
import { getSession, isAdmin } from "@/lib/dal";

// Signed-in surfaces. robots.txt already asks crawlers not to fetch these; the
// header says not to index them either, which is what stops a URL someone
// pasted elsewhere from being listed without its content.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const admin = session ? await isAdmin(session) : false;
  return (
    <AppShell nav="dashboard" isAdmin={admin}>
      {children}
    </AppShell>
  );
}
