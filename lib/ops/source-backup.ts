import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, sep } from "node:path";
import type { Pool, PoolClient } from "pg";
import { createSourceCheckpoint, verifySourceCheckpoint, type SourceCheckpoint } from "@/lib/build/durable/checkpoints";

interface Options {
  pool: Pool;
  workspaceRoot: string;
  checkpointRoot: string;
  destination: string;
  forbiddenValues?: string[];
  maxBytes?: number;
}

interface SourceReceipt {
  at: string;
  file: string;
  bytes: number;
  sha256: string;
  sourceBytes: number;
  checkpointCount: number;
  idleWorkspaces: number;
  skipped: Record<string, number>;
  credentialPolicy: string;
}

function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function credentialPath(path: string): boolean {
  return path.split("/").some(function sensitive(part) {
    return part === ".agent-home" || part === ".git" || part === ".env" || part.startsWith(".env.") ||
      ["credentials.json", ".npmrc", ".netrc", "agent-stream.log"].includes(part) || /\.(pem|key)$/.test(part) || /^id_(rsa|ed25519|ecdsa)/.test(part);
  });
}

async function checkCredentials(checkpoint: SourceCheckpoint, forbiddenValues: string[]): Promise<number> {
  let bytes = 0;
  for (const file of checkpoint.manifest.files) {
    if (credentialPath(file.path)) throw new Error("Source backup rejected a credential filename.");
    const content = await readFile(join(checkpoint.path, "files", file.path));
    if (forbiddenValues.some(function includes(value) { return value.length >= 16 && content.includes(value); })) {
      throw new Error("Source backup rejected a configured secret value.");
    }
    bytes += content.length;
  }
  return bytes;
}

async function unsafeWorkspace(client: PoolClient, projectId: string): Promise<boolean> {
  const result = await client.query(`select 1 where
    exists(select 1 from builds where project_id=$1 and status not in ('succeeded','failed','killed')) or
    exists(select 1 from build_worker_jobs j left join builds b on b.id=j.build_id
      where (b.project_id=$1 or j.workspace_key=$2) and (j.state not in ('completed','stopped') or j.lease_expires_at is not null
      or exists(select 1 from build_worker_effects e where e.build_id=j.build_id and e.state='uncertain'))) or
    exists(select 1 from audit_log where id=$3)`, [projectId, `project:${projectId}`, `project-delete:${projectId}`]);
  return result.rows.length > 0;
}

export async function createSourceBackup(options: Options): Promise<SourceReceipt> {
  const workspaceRoot = await realpath(resolve(options.workspaceRoot));
  const checkpointRoot = await realpath(resolve(options.checkpointRoot));
  await mkdir(resolve(options.destination), { recursive: true, mode: 0o700 });
  const destination = await realpath(resolve(options.destination));
  if ([workspaceRoot, checkpointRoot, destination].includes("/") ||
      contains(workspaceRoot, destination) || contains(destination, workspaceRoot) ||
      contains(checkpointRoot, destination) || contains(destination, checkpointRoot)) {
    throw new Error("Source backup destination must be separate from live storage.");
  }
  const maxBytes = options.maxBytes ?? 20 * 1024 ** 3;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid source backup limit.");
  const disk = await statfs(destination);
  if (disk.bavail * disk.bsize < maxBytes * 2 + 5 * 1024 ** 3) throw new Error("Source backup needs more free disk space.");
  const stage = await mkdtemp(join(destination, ".source-backup-"));
  const archives = join(stage, "checkpoints");
  await mkdir(archives, { mode: 0o700 });
  const skipped: Record<string, number> = {};
  const workspaceMap: { projectId: string; hash: string }[] = [];
  let sourceBytes = 0;
  let checkpointCount = 0;
  const forbiddenValues = options.forbiddenValues ?? [];
  function account(bytes: number): void {
    sourceBytes += bytes;
    if (sourceBytes > maxBytes) throw new Error("Source backup exceeded its byte limit.");
  }
  function skip(reason: string): void { skipped[reason] = (skipped[reason] ?? 0) + 1; }
  try {
    // Copy only files signed by the checkpoint manifest, never a session tree or
    // extra files that might have appeared beside the immutable source.
    for (const hash of (await readdir(checkpointRoot)).sort()) {
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const checkpoint = await verifySourceCheckpoint(checkpointRoot, hash);
      if (checkpoint.manifest.stage === "kimi_0_39_1_clean_step") { skip("agent_session_checkpoint"); continue; }
      account(await checkCredentials(checkpoint, forbiddenValues));
      const target = join(archives, hash);
      await mkdir(join(target, "files"), { recursive: true, mode: 0o700 });
      for (const file of checkpoint.manifest.files) {
        const output = join(target, "files", file.path);
        await mkdir(join(output, ".."), { recursive: true, mode: 0o700 });
        await cp(join(checkpoint.path, "files", file.path), output, { errorOnExist: true, force: false });
      }
      await cp(join(checkpoint.path, "manifest.json"), join(target, "manifest.json"), { errorOnExist: true, force: false });
      await verifySourceCheckpoint(archives, hash);
      checkpointCount += 1;
    }
    const projects = await options.pool.query<{ id: string; user_id: string; slug: string }>("select id,user_id,slug from projects order by id");
    for (const project of projects.rows) {
      const client = await options.pool.connect();
      try {
        await client.query("begin");
        // Admission and deletion use this same lock. Skip busy accounts instead
        // of waiting on their requests or copying a workspace while it changes.
        await client.query('select id from "user" where id=$1 for update nowait', [project.user_id]);
        const current = await client.query("select 1 from projects where id=$1 and user_id=$2 and slug=$3", [project.id, project.user_id, project.slug]);
        if (!current.rows.length) { skip("project_changed"); continue; }
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(project.slug)) throw new Error("Source backup rejected a project path.");
        if (await unsafeWorkspace(client, project.id)) { skip("active_or_deleting"); continue; }
        const checkpoint = await createSourceCheckpoint({ workspace: join(workspaceRoot, project.slug), archiveRoot: archives,
          buildId: project.id, attempt: 1, stage: "scheduled_idle_project", maxBytes: Math.min(64 * 1024 ** 2, maxBytes - sourceBytes),
          async assertQuiescent() { if (await unsafeWorkspace(client, project.id)) throw new Error("Workspace became active during backup."); },
        });
        account(await checkCredentials(checkpoint, forbiddenValues));
        workspaceMap.push({ projectId: project.id, hash: checkpoint.hash });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "55P03") skip("account_busy");
        else if (code === "ENOENT") skip("workspace_missing");
        else throw error;
      } finally {
        try { await client.query("rollback"); } finally { client.release(); }
      }
    }
    await writeFile(join(stage, "workspace-map.json"), JSON.stringify({ at: new Date().toISOString(), workspaceMap, skipped }) + "\n", { mode: 0o600 });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(".", "-").replace("Z", "");
    const file = `fletch-sources-${stamp}.tar.gz`;
    const temporary = join(stage, "archive.tar.gz");
    await promisify(execFile)("tar", ["-czf", temporary, "-C", stage, "checkpoints", "workspace-map.json"], { timeout: 20 * 60_000 });
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(temporary)) { hash.update(chunk); bytes += chunk.length; }
    const receipt: SourceReceipt = { at: new Date().toISOString(), file, bytes, sha256: hash.digest("hex"), sourceBytes, checkpointCount,
      idleWorkspaces: workspaceMap.length, skipped, credentialPolicy: "Manifest files only; runtime credential/session paths and configured secret values excluded. Source can contain private user data." };
    await chmod(temporary, 0o600);
    await rename(temporary, join(destination, file));
    await writeFile(join(destination, `${file}.json`), JSON.stringify(receipt) + "\n", { mode: 0o600, flag: "wx" });
    const cutoff = Date.now() - 14 * 86_400_000;
    for (const older of await readdir(destination)) {
      if (!/^fletch-sources-\d{8}-\d{6}-\d{3}\.tar\.gz$/.test(older) || older === file) continue;
      const path = join(destination, older);
      if ((await stat(path)).mtimeMs >= cutoff) continue;
      await unlink(path);
      await unlink(`${path}.json`).catch(function absent(error: NodeJS.ErrnoException) { if (error.code !== "ENOENT") throw error; });
    }
    return receipt;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
