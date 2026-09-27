export const metadata = { title: "Operator console", robots: { index: false, follow: false, nocache: true } };

import type { ReactNode } from "react";
import { AppShell } from "@/components/dashboard/app-shell";
import { LockBar } from "@/components/admin/lock-bar";
import { requireAdmin } from "@/lib/dal";

// The layout turns non-admins away at the door; every page underneath checks
// again, because a layout does not re-run on client navigation between pages.
// The unlock page sits outside this group, so it renders without the shell.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <AppShell nav="admin" isAdmin>
      <LockBar />
      {children}
    </AppShell>
  );
}
