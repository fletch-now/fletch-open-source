import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { generatedProjectName } from "./project-name-rules";

test("project names come from a bounded explicit agent manifest", function names() {
  assert.equal(generatedProjectName('{"name":" Island  Atlas "}'), "Island Atlas");
  for (const text of [null, "# Project Specification", "{}", '{"name":"### Project"}', '{"name":"<script>"}', JSON.stringify({ name: "x".repeat(61) })]) {
    assert.equal(generatedProjectName(text), null);
  }
});

test("generated names replace placeholders and preserve user and legacy names", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function saved() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, projects } = await import("@/lib/db/schema");
  const { applyGeneratedProjectName } = await import("./project-name");
  const root = await mkdtemp(join(tmpdir(), "fletch-name-test-"));
  const previousRoot = process.env.FORGE_WORKSPACE_ROOT;
  process.env.FORGE_WORKSPACE_ROOT = root;
  const id = randomUUID(), owner = randomUUID();
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "review"));
    await writeFile(join(root, "review", "fletch.project.json"), '{"name":"Island Atlas"}');
    await db.insert(user).values({ id: owner });
    await db.insert(projects).values({ id, userId: owner, slug: "review", name: "Untitled app", nameSource: "placeholder" });
    await applyGeneratedProjectName(id);
    assert.equal((await db.select().from(projects).where(eq(projects.id, id)))[0].name, "Island Atlas");
    for (const nameSource of ["user", "legacy"] as const) {
      await db.update(projects).set({ name: "My chosen name", nameSource }).where(eq(projects.id, id));
      await applyGeneratedProjectName(id);
      assert.equal((await db.select().from(projects).where(eq(projects.id, id)))[0].name, "My chosen name");
    }
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await rm(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.FORGE_WORKSPACE_ROOT;
    else process.env.FORGE_WORKSPACE_ROOT = previousRoot;
    await close();
  }
});
