// Serves Swagger UI's own files from node_modules, by an allow-list, so the
// docs page depends on nothing outside this origin. Each file is read from
// disk once and kept: they change only with a deploy.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Plain names on the URL: the dynamic segment does not carry dotted file names.
const ALLOWED: Record<string, { file: string; type: string }> = {
  css: { file: "swagger-ui.css", type: "text/css; charset=utf-8" },
  bundle: { file: "swagger-ui-bundle.js", type: "application/javascript; charset=utf-8" },
  preset: { file: "swagger-ui-standalone-preset.js", type: "application/javascript; charset=utf-8" },
};

// The app runs from its own root in every environment, and Next's bundler
// rewrites module resolution, so the path is spelled out.
function distDir(): string {
  return join(process.cwd(), "node_modules", "swagger-ui-dist");
}

const loaded = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();

function bytesFor(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const pending = loaded.get(file);
  if (pending) {
    return pending;
  }
  const reading = readFile(join(distDir(), file))
    .then(function copy(buffer) {
      return new Uint8Array(buffer);
    })
    .catch(function missing() {
      // Not kept: a file that is missing now may be there after the next deploy.
      loaded.delete(file);
      return null;
    });
  loaded.set(file, reading);
  return reading;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/v1/docs/assets/[file]">): Promise<Response> {
  const { file } = await ctx.params;
  const asset = Object.hasOwn(ALLOWED, file) ? ALLOWED[file] : undefined;
  if (!asset) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await bytesFor(asset.file);
  if (!bytes) {
    return new Response("API reference asset is temporarily unavailable", { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } });
  }
  return new Response(bytes, { headers: { "content-type": asset.type, "cache-control": "public, max-age=300" } });
}
