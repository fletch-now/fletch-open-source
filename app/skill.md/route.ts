import { skillGuide } from "@/lib/api/llm-reference";
import { createHash } from "node:crypto";

export function GET(request: Request): Response {
  const body = skillGuide();
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const headers = {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "ETag",
      etag,
  };
  const matched = request.headers.get("if-none-match")?.split(",").some((value) => value.trim().replace(/^W\//, "") === etag || value.trim() === "*");
  return new Response(matched ? null : body, { status: matched ? 304 : 200, headers });
}
