import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceArtifacts, readWorkspaceFile } from "./workspace-files";

test("live file snapshots observe writes and removals while excluding private paths and links", async function snapshot() {
  const root = await mkdtemp(join(tmpdir(), "fletch-live-files-"));
  const workspace = join(root, "project");
  await mkdir(workspace);
  try {
    await writeFile(join(root, "outside.txt"), "private");
    await writeFile(join(workspace, ".env"), "secret");
    await symlink(join(root, "outside.txt"), join(workspace, "link.txt"));
    assert.deepEqual(await listWorkspaceArtifacts(workspace), []);
    await writeFile(join(workspace, "App.sol"), "contract First {}");
    const first = await listWorkspaceArtifacts(workspace);
    assert.deepEqual(first.map(function path(file) { return file.path; }), ["App.sol"]);
    await writeFile(join(workspace, "App.sol"), "contract Second {}");
    const changed = await listWorkspaceArtifacts(workspace);
    assert.notEqual(changed[0].contentHash, first[0].contentHash);
    assert.equal(await readWorkspaceFile(workspace, "App.sol"), "contract Second {}");
    assert.equal(await readWorkspaceFile(workspace, "link.txt"), null);
    assert.equal(await readWorkspaceFile(workspace, "../outside.txt"), null);
    assert.equal(await readWorkspaceFile(workspace, ".env"), null);
    await assert.rejects(listWorkspaceArtifacts(workspace, { entries: 0, bytes: 1024 }), /too many entries/);
    await assert.rejects(listWorkspaceArtifacts(workspace, { entries: 20, bytes: 1 }), /too large/);
    await rm(join(workspace, "App.sol"));
    assert.deepEqual(await listWorkspaceArtifacts(workspace), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
