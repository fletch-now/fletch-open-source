import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { overDiskCap } from "./cli-builder";
import { sweepWorkspaces } from "./reaper";

test("an oversized turn retains earlier source, new work and provider session files", async function (t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-disk-retention-"));
  const previous = process.env.FORGE_WORKSPACE_MAX_BYTES;
  process.env.FORGE_WORKSPACE_MAX_BYTES = "1024";
  t.after(async function cleanup() {
    if (previous === undefined) delete process.env.FORGE_WORKSPACE_MAX_BYTES;
    else process.env.FORGE_WORKSPACE_MAX_BYTES = previous;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, ".agent-home", ".kimi-code", "sessions"), { recursive: true });
  const files = new Map([
    ["prior-contract.sol", "contract Prior {}"],
    ["new-progress.ts", "x".repeat(2048)],
    [".agent-home/.kimi-code/sessions/checkpoint.json", '{"session":"synthetic-progress"}'],
  ]);
  for (const [path, content] of files) await writeFile(join(root, path), content);
  assert.equal(await overDiskCap(root), true);
  for (const [path, content] of files) assert.equal(await readFile(join(root, path), "utf8"), content);
});

test("workspace maintenance preserves old projects and an active project with an old parent-directory timestamp", async function (t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-sweep-retention-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const old = new Date(Date.now() - 30 * 86_400_000);
  for (const slug of ["old-project", "active-project"]) {
    await mkdir(join(root, slug, "src"), { recursive: true });
    await writeFile(join(root, slug, "src", "app.ts"), `saved ${slug}`);
    await utimes(join(root, slug), old, old);
  }
  await writeFile(join(root, "active-project", "src", "progress.ts"), "work completed just now");
  const swept = await sweepWorkspaces(root);
  assert.equal(swept.removed, 0);
  assert.ok(swept.keptBytesApprox > 0);
  assert.equal(await readFile(join(root, "old-project", "src", "app.ts"), "utf8"), "saved old-project");
  assert.equal(await readFile(join(root, "active-project", "src", "progress.ts"), "utf8"), "work completed just now");
});
