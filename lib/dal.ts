import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "@/lib/auth";
import { ADMIN_WALLETS } from "@/lib/config";
import { hasAdminUnlock } from "@/lib/admin/gate";
import { walletsForUser } from "@/lib/wallets";

// Memoized per request. This is the authz boundary — proxy.ts only does
// optimistic cookie-presence redirects and never verifies sessions. A banned
// account (admin console) is treated as signed out everywhere, including its
// existing sessions, since the ban is written straight to the user row.
export const getSession = cache(async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user.banned) {
    return null;
  }
  return session;
});

export async function verifySession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }
  return session;
}

export async function isAdmin(session: Session): Promise<boolean> {
  const roles = (session.user.role ?? "").split(",").map((role) => role.trim());
  if (roles.includes("admin")) {
    return true;
  }
  if (ADMIN_WALLETS.length === 0) {
    return false;
  }
  const wallets = await walletsForUser(session.user.id);
  return wallets.some((address) => ADMIN_WALLETS.includes(address.toLowerCase()));
}

// Who is driving the console: the wallet account if one is signed in, for the
// audit trail and for "not yourself" checks, otherwise the bare console.
export interface Operator {
  userId: string | null;
  name: string;
}

// The console is opened by the operator password (lib/admin/gate.ts). Every
// admin page and action calls this, so a console left open cannot be driven
// after the unlock cookie expires.
export async function requireAdmin(): Promise<Operator> {
  if (!(await hasAdminUnlock())) {
    redirect("/trafalgar/unlock");
  }
  const session = await getSession();
  return session ? { userId: session.user.id, name: session.user.name } : { userId: null, name: "console" };
}
