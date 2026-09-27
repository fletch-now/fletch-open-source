import { fullApiReference } from "@/lib/api/llm-reference";

export function GET(): Response {
  return new Response(fullApiReference(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "access-control-allow-origin": "*",
    },
  });
}
