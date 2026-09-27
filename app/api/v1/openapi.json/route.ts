// GET /api/v1/openapi.json — the API described in OpenAPI 3.1. Unauthenticated:
// it is documentation, and a client needs it before it has a key. The document
// is a module constant, so it is serialized and hashed once, at load.

import { createHash } from "node:crypto";
import { openApiDocument } from "@/lib/api/openapi";

const BODY = JSON.stringify(openApiDocument);
const ETAG = `W/"${createHash("sha1").update(BODY).digest("base64url").slice(0, 27)}"`;
const HEADERS = { etag: ETAG, "cache-control": "public, max-age=300", "access-control-allow-origin": "*" };

export async function GET(request: Request): Promise<Response> {
  if (request.headers.get("if-none-match") === ETAG) {
    return new Response(null, { status: 304, headers: HEADERS });
  }
  return new Response(BODY, { headers: { ...HEADERS, "content-type": "application/json" } });
}
