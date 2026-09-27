import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSourceCheckpoint, restoreSourceCheckpoint, verifySourceCheckpoint } from "./checkpoints";

test("immutable checkpoints restore exact sources on a clean directory and retain live edits and session state", async function checkpoints(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-checkpoint-")));
  t.after(async function cleanup() { await rm(root, { recursive: true, force: true }); });
  const workspace = join(root, "workspace");
  const archiveRoot = join(root, "archive");
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(join(workspace, ".agent-home", ".kimi-code", "sessions"), { recursive: true });
  await writeFile(join(workspace, "src", "Raffle.sol"), "contract Raffle {}\n");
  await writeFile(join(workspace, "package.json"), '{"name":"fixture"}');
  await writeFile(join(workspace, "core"), "user-authored source named core");
  await writeFile(join(workspace, ".env"), "SECRET=fixture-secret");
  await writeFile(join(workspace, ".agent-home", ".kimi-code", "config.toml"), "token=fixture-token");
  await writeFile(join(workspace, ".agent-home", ".kimi-code", "sessions", "fixture.json"), '{"session":"retained"}');
  const options = { workspace, archiveRoot, buildId: "build-1", attempt: 1, stage: "compiled", async assertQuiescent(): Promise<void> {} };

  const checkpoint = await createSourceCheckpoint(options);
  assert.deepEqual(checkpoint.manifest.files.map(function path(file) { return file.path; }), ["core", "package.json", "src/Raffle.sol"]);
  assert.equal(checkpoint.manifest.continuation, "unavailable");
  assert.equal((await createSourceCheckpoint(options)).hash, checkpoint.hash);
  await writeFile(join(workspace, "src", "Raffle.sol"), "contract Raffle { uint newer; }\n");
  await restoreSourceCheckpoint(archiveRoot, checkpoint.hash, join(root, "restored"));
  assert.equal(await readFile(join(root, "restored", "src", "Raffle.sol"), "utf8"), "contract Raffle {}\n");
  assert.equal(await readFile(join(root, "restored", "core"), "utf8"), "user-authored source named core");
  assert.match(await readFile(join(workspace, "src", "Raffle.sol"), "utf8"), /newer/);
  assert.equal(await readFile(join(workspace, ".agent-home", ".kimi-code", "config.toml"), "utf8"), "token=fixture-token");
  await assert.rejects(restoreSourceCheckpoint(archiveRoot, checkpoint.hash, workspace), /EEXIST/);
  await assert.rejects(createSourceCheckpoint({ ...options, archiveRoot: join(workspace, "backups") }), /separate/);
});

test("checkpoint rejects overflow, changed source, symlinks, hardlinks and failed quiescence without deleting source", async function rejects(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-checkpoint-")));
  t.after(async function cleanup() { await rm(root, { recursive: true, force: true }); });
  const workspace = join(root, "workspace");
  const archiveRoot = join(root, "archive");
  await mkdir(workspace);
  await writeFile(join(workspace, "source.ts"), "original source");
  const options = { workspace, archiveRoot, buildId: "build-1", attempt: 1, stage: "saved", async assertQuiescent(): Promise<void> {} };
  await assert.rejects(createSourceCheckpoint({ ...options, maxBytes: 1 }), /limit/);
  assert.equal(await readFile(join(workspace, "source.ts"), "utf8"), "original source");
  await symlink(join(workspace, "source.ts"), join(workspace, "linked.ts"));
  await assert.rejects(createSourceCheckpoint(options), /symlink/);
  await rm(join(workspace, "linked.ts"));
  await link(join(workspace, "source.ts"), join(workspace, "hardlink.ts"));
  await assert.rejects(createSourceCheckpoint(options), /unsafe/);
  await rm(join(workspace, "hardlink.ts"));
  let calls = 0;
  await assert.rejects(createSourceCheckpoint({ ...options, async assertQuiescent() {
    calls += 1;
    if (calls === 2) await writeFile(join(workspace, "source.ts"), "newer source");
  } }), /changed/);
  await assert.rejects(createSourceCheckpoint({ ...options, async assertQuiescent() { throw new Error("Sandbox is still running."); } }), /still running/);
  assert.equal(await readFile(join(workspace, "source.ts"), "utf8"), "newer source");
  assert.deepEqual(await readdir(archiveRoot), []);
});

test("manifest and content corruption prevent restore before any destination files are created", async function corrupt(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-checkpoint-")));
  t.after(async function cleanup() { await rm(root, { recursive: true, force: true }); });
  const workspace = join(root, "workspace");
  const archiveRoot = join(root, "archive");
  await mkdir(workspace);
  await writeFile(join(workspace, "app.ts"), "original");
  const checkpoint = await createSourceCheckpoint({ workspace, archiveRoot, buildId: "build-1", attempt: 1, stage: "saved", async assertQuiescent() {} });
  const path = join(checkpoint.path, "files", "app.ts");
  await chmod(path, 0o600);
  await writeFile(path, "tampered");
  await assert.rejects(restoreSourceCheckpoint(archiveRoot, checkpoint.hash, join(root, "restored")), /hash mismatch/);
  await assert.rejects(readdir(join(root, "restored")), /ENOENT/);
  await chmod(join(checkpoint.path, "manifest.json"), 0o600);
  await writeFile(join(checkpoint.path, "manifest.json"), "{}");
  await assert.rejects(verifySourceCheckpoint(archiveRoot, checkpoint.hash), /manifest hash/);
});
