import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One directory per project, keyed by slug (lib/build/cli-builder.ts). The default
// is the OS temp dir, which is swept on reboot; production sets
// FORGE_WORKSPACE_ROOT to a persistent path so follow-up prompts find their files.
export function workspaceRoot(): string {
  return process.env.FORGE_WORKSPACE_ROOT ?? join(tmpdir(), "fletch-workspaces");
}

// Bytes under a directory, following no symlinks. Used by the reaper's sweep,
// the admin System page, and the per-build size cap.
export async function directoryBytes(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(function missing() {
    return [];
  });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(child);
    } else if (entry.isFile()) {
      const info = await stat(child).catch(function gone() {
        return null;
      });
      total += info?.size ?? 0;
    }
  }
  return total;
}

// A build may leave this much on disk. Contracts and a small front end are a
// few hundred kilobytes; anything near the cap is an agent writing junk or a
// prompt trying to fill the volume.
export function workspaceMaxBytes(): number {
  return Number(process.env.FORGE_WORKSPACE_MAX_BYTES ?? 64 * 1024 * 1024);
}

// A file under the agent's workspace, read only if it is a plain file of a
// sane size: the agent controls that tree and can leave a symlink to another
// workspace or a FIFO that would block the server forever.
export async function readWorkspaceFile(path: string, maxBytes = 32 * 1024 * 1024): Promise<string | null> {
  const { lstat, readFile } = await import("node:fs/promises");
  const stat = await lstat(path).catch(function missing() {
    return null;
  });
  if (!stat || !stat.isFile() || stat.size > maxBytes) {
    return null;
  }
  return readFile(path, "utf8").catch(function unreadable() {
    return null;
  });
}
