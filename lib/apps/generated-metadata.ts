import { readWorkspaceFile } from "@/lib/build/workspace-files";

export interface GeneratedAppMetadata { title: string; summary: string; description: string }

function plain(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function decodeEntities(value: string | undefined): string {
  return (value ?? "").replace(/&(?:amp|lt|gt|quot|apos|#39|#(x[0-9a-f]+|[0-9]+));/gi, (entity, code: string | undefined) => {
    if (code) {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '\"', "&apos;": "'", "&#39;": "'" };
    return entities[entity.toLowerCase()] ?? entity;
  });
}

export function appMetadata(manifest: string | null, html: string | null, name: string): GeneratedAppMetadata {
  let parsed: Record<string, unknown> = {};
  try { const value: unknown = JSON.parse(manifest ?? "{}"); if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>; } catch { /* Older apps may only have HTML metadata. */ }
  const htmlTitle = html?.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1];
  const descriptionTag = html?.match(/<meta\b(?=[^>]*\bname\s*=\s*["']description["'])[^>]*>/i)?.[0];
  const htmlSummary = descriptionTag?.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];
  const title = plain(parsed.name, 60) || plain(decodeEntities(htmlTitle), 60) || plain(name, 60) || "Untitled app";
  const summary = plain(parsed.summary, 160) || plain(decodeEntities(htmlSummary), 160) || `${title}. A web app built with Fletch.`;
  const description = plain(parsed.description, 2400) || summary;
  return { title, summary, description };
}

export async function readGeneratedAppMetadata(workspace: string, name: string): Promise<GeneratedAppMetadata> {
  const [manifest, html] = await Promise.all([
    readWorkspaceFile(workspace, "fletch.project.json", 16_384),
    readWorkspaceFile(workspace, "index.html", 512_000),
  ]);
  return appMetadata(manifest, html, name);
}
