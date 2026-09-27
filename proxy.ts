import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_GATE_COOKIE } from "@/lib/auth-cookie";

// Next 16 renamed middleware -> proxy (Node runtime only). This does ONLY an
// optimistic cookie-presence redirect for the admin section; actual authorization
// lives in lib/dal.ts, called from every page and server action.
const GATED_PREFIXES = ["/trafalgar"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isGated = GATED_PREFIXES.some(function matches(prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
  if (!isGated) {
    return NextResponse.next();
  }
  // The password gate's cookie is verified in lib/admin/gate.ts; here only its
  // presence is checked, so a console URL without it goes straight to the unlock.
  if (pathname !== "/trafalgar/unlock" && !request.cookies.get(ADMIN_GATE_COOKIE)) {
    return NextResponse.redirect(new URL("/trafalgar/unlock", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/trafalgar/:path*"],
};
