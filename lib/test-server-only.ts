import Module from "node:module";
import { resolve } from "node:path";

// These tests run server modules directly, outside Next's bundler. This scoped
// marker shim supports the repository's Node 20+ test runtime without importing Next.
const loader = Module as unknown as { _resolveFilename: (request: string, parent: unknown, ...options: unknown[]) => string };
const original = loader._resolveFilename;
loader._resolveFilename = function resolveTestMarker(request: string, parent: unknown, ...options: unknown[]): string {
  if (request === "server-only") return resolve("scripts/test-server-only.cjs");
  return original.call(this, request, parent, ...options);
};
