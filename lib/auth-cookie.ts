// The session cookie's name, shared by the auth server and the proxy that checks
// for it. In production the name carries the __Host- prefix: a browser then
// refuses to store a cookie of that name with a Domain attribute, so a page on
// apps.fletch.now cannot plant one on fletch.now (cookie tossing, HOSTING.md §2).
// A __Host- cookie must be Secure, which localhost over http cannot be, so
// development keeps the plain name. No "server-only": proxy.ts runs on the edge.

const PRODUCTION = process.env.NODE_ENV === "production";

export const SESSION_COOKIE_PREFIX = PRODUCTION ? "__Host-fletch" : "better-auth";

// better-auth adds its own __Secure- prefix when secure cookies are on. Off, so
// the name starts with __Host- exactly; the Secure attribute is set explicitly.
export const USE_SECURE_COOKIE_PREFIX = false;
export const COOKIE_SECURE = PRODUCTION;

// The admin console's second gate (lib/admin/gate.ts): a signed, session-bound
// cookie set only after the operator password is entered. Same __Host- rule.
export const ADMIN_GATE_COOKIE = PRODUCTION ? "__Host-fletch.admin" : "fletch.admin";
