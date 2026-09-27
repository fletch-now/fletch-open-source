import { APP_URL } from "@/lib/config";

export function keyMutationOriginAllowed(request: Request, origin = new URL(process.env.BETTER_AUTH_URL ?? APP_URL).origin): boolean {
  // TLS terminates at the proxy; request.url can carry its internal HTTP origin.
  // Trust deployment configuration, never forwarded headers supplied by a caller.
  const site = request.headers.get("sec-fetch-site");
  return request.headers.get("origin") === origin && (site === null || site === "same-origin" || site === "none");
}
