import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { account, user } from "@/lib/db/schema";

// DEV-ONLY one-click test login. Creates an admin test user with a session cookie so
// the dashboard/admin/build flow can be tested without a wallet. Hard-gated on
// FORGE_DEV_LOGIN=1 — NEVER set that in production; this is a full admin backdoor.
const DEV_EMAIL = "dev@forge.local";
const DEV_PASSWORD = "forge-dev-pass-123";

async function hasCredentialAccount(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(eq(user.email, email))
    .limit(1);
  return rows.length > 0;
}

export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.FORGE_DEV_LOGIN !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Sign in only when a usable credential account exists. A half-created user (row
  // present, no account) is removed so sign-up can recreate it cleanly.
  const canSignIn = await hasCredentialAccount(DEV_EMAIL);
  if (!canSignIn) {
    await db.delete(user).where(eq(user.email, DEV_EMAIL));
  }

  let authResponse: Response;
  try {
    authResponse = canSignIn
      ? await auth.api.signInEmail({
          body: { email: DEV_EMAIL, password: DEV_PASSWORD },
          asResponse: true,
        })
      : await auth.api.signUpEmail({
          body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: "Dev Tester" },
          asResponse: true,
        });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "dev login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const cookies = authResponse.headers.getSetCookie();
  if (cookies.length === 0) {
    return NextResponse.json(
      { error: "dev login produced no session", status: authResponse.status },
      { status: 500 },
    );
  }

  // Make the test user an admin so /admin is reachable.
  await db.update(user).set({ role: "admin" }).where(eq(user.email, DEV_EMAIL));

  const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
  for (const cookie of cookies) {
    redirect.headers.append("set-cookie", cookie);
  }
  return redirect;
}
