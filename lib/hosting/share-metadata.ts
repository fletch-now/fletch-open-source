import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APPS_DOMAIN, APP_URL } from "@/lib/config";
import { readGeneratedAppMetadata } from "@/lib/apps/generated-metadata";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function lines(text: string, width: number, count: number): string[] {
  const words = text.split(/\s+/);
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) { result.push(line); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) result.push(line);
  return result.slice(0, count).map(value => value.length > width + 10 ? value.slice(0, width) + "…" : value);
}

// Called only after the sandbox has exited and the output tree has passed the
// regular-file checks. Metadata is frozen with the saved preview's byte manifest.
export async function prepareShareMetadata(dist: string, workspace: string, slug: string, name: string): Promise<void> {
  const html = await readFile(join(dist, "index.html"), "utf8");
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0];
  if (!head) return;
  const metadata = await readGeneratedAppMetadata(workspace, name);
  const url = `https://${slug}.${APPS_DOMAIN}/`;
  const image = `${url}fletch-share.png`;
  const titleLines = lines(metadata.title, 26, 3);
  const summaryLines = lines(metadata.summary, 66, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0c100e"/>
    <path d="M920 0V630M1040 0V630M800 0V630M0 160H1200M0 480H1200" stroke="#22392c"/>
    <circle cx="1075" cy="280" r="135" fill="#00cf18"/><path d="M990 355l135-135m-110 0h110v110" fill="none" stroke="#0c100e" stroke-width="18"/>
    <rect x="48" y="42" width="250" height="44" rx="22" fill="#183321"/>
    <text x="70" y="72" font-family="sans-serif" font-size="22" fill="#92ff9a">APP BUILT WITH FLETCH</text>
    ${titleLines.map((line, i) => `<text x="56" y="${180 + i * 72}" font-family="sans-serif" font-size="62" font-weight="700" fill="#f4f8f1">${escapeHtml(line)}</text>`).join("")}
    ${summaryLines.map((line, i) => `<text x="58" y="${405 + i * 34}" font-family="sans-serif" font-size="25" fill="#b5c8bb">${escapeHtml(line)}</text>`).join("")}
    <text x="56" y="560" font-family="sans-serif" font-size="24" fill="#b5c8bb">${escapeHtml(slug)}.apps.fletch.now</text>
    <rect x="745" y="512" width="405" height="76" rx="38" fill="#00cf18"/>
    <text x="780" y="559" font-family="sans-serif" font-size="27" font-weight="700" fill="#0c100e">Build your app at fletch.now</text>
  </svg>`;
  await writeFile(join(dist, "fletch-share.png"), await sharp(Buffer.from(svg)).png().toBuffer());
  await writeFile(join(dist, "fletch-share.json"), JSON.stringify(metadata));
  const tags = [
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.summary)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    ...Object.entries({ "og:type": "website", "og:title": metadata.title, "og:description": metadata.summary, "og:url": url, "og:image": image, "og:image:width": "1200", "og:image:height": "630", "og:image:alt": `${metadata.title}. Built with Fletch.`, "og:site_name": metadata.title }).map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}">`),
    ...Object.entries({ "twitter:card": "summary_large_image", "twitter:title": metadata.title, "twitter:description": metadata.summary, "twitter:image": image, "twitter:site": "@fletch_now" }).map(([key, value]) => `<meta name="${key}" content="${escapeHtml(value)}">`),
    `<script data-fletch-share type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebApplication", name: metadata.title, description: metadata.summary, url, image, operatingSystem: "Web browser", isBasedOn: APP_URL }).replaceAll("<", "\\u003c")}</script>`,
  ].join("\n");
  // Replace only metadata elements in head. Scripts, app markup and owner code
  // stay intact. Generated tags are idempotent for a repeated preview build.
  const cleaned = head.replace(/<script\b(?=[^>]*\bdata-fletch-share)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\b[^>]*>/gi, tag => /\b(?:name|property)\s*=\s*["'](?:description|og:[^"']+|twitter:[^"']+)["']/i.test(tag) ? "" : tag)
    .replace(/<link\b[^>]*>/gi, tag => /\brel\s*=\s*["']canonical["']/i.test(tag) ? "" : tag);
  let output = html.replace(head, () => cleaned.replace(/<\/head>/i, () => `${tags}\n</head>`));
  if (!output.includes('data-fletch-build-link')) output = output.replace(/<\/body>/i, () => `<a data-fletch-build-link href="${escapeHtml(APP_URL)}/dashboard/build?utm_source=shared-app&amp;utm_medium=badge" target="_blank" rel="noopener noreferrer" style="position:fixed;right:12px;bottom:12px;z-index:40;display:inline-flex;gap:6px;align-items:center;padding:9px 13px;border:1px solid #ffffff40;border-radius:999px;background:#0c100e;color:#f4f8f1;font:500 12px/1.4 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 10px #0002">Built with Fletch <span aria-hidden="true">↗</span></a></body>`);
  await writeFile(join(dist, "index.html"), output);
  await writeDefault(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(url)}</loc></url></urlset>`);
  await writeDefault(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${url}sitemap.xml\n`);
}

async function writeDefault(path: string, content: string): Promise<void> {
  try { await writeFile(path, content, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
