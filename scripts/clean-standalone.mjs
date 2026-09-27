import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Next can explicitly copy .env/.env.production into standalone output, and
// dynamic filesystem tracing can include operator directories. Runtime secrets
// are supplied by the service environment, never shipped inside the artifact.
const root = join(process.cwd(), ".next", "standalone");
const privateEntries = new Set([
  ".git", ".local", ".codex", ".claude", ".mcp.json", ".npmrc", ".netrc",
  "release-config", "private", "backups", "workspaces", "checkpoints", "sites",
  "marketing", "playwright-report", "test-results",
]);
let removed = 0;
for (const entry of await readdir(root)) {
  if (privateEntries.has(entry) || (entry.startsWith(".env") && entry !== ".env.example")) {
    await rm(join(root, entry), { recursive: true, force: true });
    removed++;
  }
}
console.log(`Standalone artifact checked; removed ${removed} private configuration/data entries.`);
