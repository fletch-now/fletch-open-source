import { readDraftFile, readSiteDraft, validPreviewToken } from "@/lib/hosting/drafts";
import { previewResponse } from "@/lib/hosting/preview-response";

export async function GET(_request: Request, ctx: RouteContext<"/api/previews/[buildId]/[token]/[...path]">): Promise<Response> {
  const { buildId, token, path } = await ctx.params;
  if (!validPreviewToken(buildId, token)) return new Response("This preview link expired. Refresh the preview in your dashboard.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const draft = await readSiteDraft(buildId);
  const file = draft ? await readDraftFile(draft, path).catch(() => null) : null;
  if (!file) return new Response("Preview file not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  // The response sandbox also applies to direct navigation to the preview URL.
  const frameOrigins = process.env.NODE_ENV === "production" ? "https://fletch.now" : "https://fletch.now http://localhost:* http://127.0.0.1:*";
  return previewResponse(file, path.at(-1)!, frameOrigins);
}
