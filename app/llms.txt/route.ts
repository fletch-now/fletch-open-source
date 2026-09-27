import { integrationGuide } from "@/lib/api/llm-reference";

export function GET(): Response {
  return new Response(integrationGuide(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
