import { randomBytes } from "node:crypto";
import { extname } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// The opaque preview origin has no browser storage. Libraries can use this
// temporary store while the browser still isolates cookies, parent and network.
const PREVIEW_STORAGE = `
window.__FLETCH_DRAFT_PREVIEW__ = true;
for (const name of ['localStorage', 'sessionStorage']) {
  const entries = new Map();
  const storage = {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(String(key)) ?? null; },
    setItem(key, value) { entries.set(String(key), String(value)); },
    removeItem(key) { entries.delete(String(key)); },
    clear() { entries.clear(); }
  };
  Object.defineProperty(window, name, { value: storage });
}
`;

export function previewResponse(file: Buffer, path: string, frameOrigins: string): Response {
  const mime = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const nonce = randomBytes(18).toString("base64");
  let body: BodyInit = new Uint8Array(file);
  if (mime.startsWith("text/html")) {
    const bootstrap = `<script nonce="${nonce}">${PREVIEW_STORAGE}</script>`;
    // Insert before every app script, while preserving the doctype's standards mode.
    body = file.toString("utf8").replace(/^(\s*<!doctype[^>]*>)?/i, `$&${bootstrap}`);
  }
  return new Response(body, { headers: {
    "Content-Type": mime,
    "Cache-Control": mime.startsWith("text/html") ? "private, no-store" : "private, max-age=300",
    "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src https: wss:; frame-ancestors ${frameOrigins}; base-uri 'none'; form-action 'none'; object-src 'none'`,
    "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()", "X-Robots-Tag": "noindex, nofollow, noarchive",
  } });
}
