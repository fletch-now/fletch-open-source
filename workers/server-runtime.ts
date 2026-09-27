import Module from "node:module";
import { createRequire } from "node:module";

// Next resolves this build-time marker while bundling server routes. A daemon
// is already a server process and uses Next's empty server marker directly.
const require = createRequire(import.meta.url);
const marker = require.resolve("next/dist/compiled/server-only/empty.js");
const loader = Module as unknown as { _resolveFilename: (name: string, parent: unknown, ...options: unknown[]) => string };
const original = loader._resolveFilename;
loader._resolveFilename = function resolveServerMarker(name: string, parent: unknown, ...options: unknown[]): string {
  if (name === "server-only") return marker;
  return original.call(this, name, parent, ...options);
};
