import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isImageAttachment } from "@/lib/build/attachments";
import type { BuildAttachment } from "@/lib/build/types";

// A name that cannot escape the workspace or collide with the app's own files:
// one path segment, ordinary characters, under `brief/`. The agent reads these
// as files, so a long spec costs nothing against the prompt.
function safeAttachmentName(name: string): string | null {
  const base = name.trim();
  return /^[\w][\w.\- ]{0,63}$/.test(base) ? base : null;
}

// The workspace persists between builds and the agent writes into it, so
// `brief/` may already exist as something the agent made. A symlink there would
// send these writes anywhere on the host the fletch user can reach, so the
// directory is replaced unless it is a real directory, and every write is
// checked to land inside it.
async function briefDirectory(workspace: string): Promise<string> {
  const dir = join(workspace, "brief");
  const existing = await lstat(dir).catch(function missing() {
    return null;
  });
  if (existing && !existing.isDirectory()) {
    await rm(dir, { force: true });
  }
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeAttachments(workspace: string, attachments: BuildAttachment[]): Promise<string[]> {
  if (attachments.length === 0) {
    return [];
  }
  const dir = await briefDirectory(workspace);
  const written: string[] = [];
  for (const attachment of attachments) {
    const name = safeAttachmentName(attachment.name);
    if (!name) {
      continue;
    }
    const target = join(dir, name);
    if (!target.startsWith(`${dir}/`)) {
      continue;
    }
    // wx would refuse a second build's rewrite; unlinking first refuses to
    // follow a symlink the agent left in place of a previous attachment.
    await rm(target, { force: true });
    const bytes = isImageAttachment(attachment) ? Buffer.from(attachment.data, "base64") : Buffer.from(attachment.content, "utf8");
    await writeFile(target, bytes, { flag: "wx" });
    written.push(`brief/${name}`);
  }
  return written;
}
