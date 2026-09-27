import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { draftDirectory, draftPreviewUrl, prepareSiteDraft, readDraftFile, validPreviewToken, verifySiteDraft } from "./drafts";
import { publicationStatus, requestPublication, runPublicationOnce } from "./publications";

const DATABASE = process.env.FLETCH_TEST_DATABASE_URL;

test("saved previews and durable publication preserve ownership and the confirmed site", { skip: !DATABASE }, async function integration(t) {
  const admin = new Pool({ connectionString: DATABASE });
  const namespace = `publication_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(DATABASE!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  const database = new Pool({ connectionString: url.toString(), max: 4 });
  const root = await mkdtemp(join(tmpdir(), "fletch-manual-publication-"));
  const prior = { drafts: process.env.FORGE_DRAFTS_ROOT, sites: process.env.FORGE_SITES_ROOT, path: process.env.PATH, secret: process.env.BETTER_AUTH_SECRET };
  process.env.FORGE_DRAFTS_ROOT = join(root, "drafts");
  process.env.FORGE_SITES_ROOT = join(root, "sites");
  process.env.BETTER_AUTH_SECRET = "controlled-preview-secret-of-32-characters";
  const fetch = globalThis.fetch;
  let responseStatus = 200;
  let requests = 0;
  globalThis.fetch = async function reachable(): Promise<Response> { requests++; return new Response("Controlled HTTPS", { status: responseStatus }); };
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin/sudo"), "#!/bin/sh\nexit 0\n");
  await chmod(join(root, "bin/sudo"), 0o755);
  process.env.PATH = `${join(root, "bin")}:${prior.path}`;
  for (const table of ["user", "projects", "builds", "audit_log"]) {
    await database.query(`create table "${table}" (like public."${table}" including all)`);
  }
  await database.query(await readFile("drizzle/0066_site_drafts.sql", "utf8"));
  t.after(async function cleanup() {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries({ FORGE_DRAFTS_ROOT: prior.drafts, FORGE_SITES_ROOT: prior.sites, PATH: prior.path, BETTER_AUTH_SECRET: prior.secret })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await database.end();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  });
  const owner = randomUUID();
  const project = randomUUID();
  const slug = `fixture-${project}`;
  await database.query('insert into "user"(id) values($1)', [owner]);
  await database.query("insert into projects(id,user_id,slug,name) values($1,$2,$3,'Publication fixture')", [project, owner, slug]);

  async function stage(body: string) {
    const id = randomUUID();
    const dist = join(root, `dist-${id}`);
    await database.query("insert into builds(id,user_id,project_id,prompt,status) values($1,$2,$3,'Controlled fixture','succeeded')", [id, owner, project]);
    await mkdir(dist);
    await writeFile(join(dist, "index.html"), body);
    const draft = await prepareSiteDraft(id, dist, database);
    return { draft, dist };
  }

  const first = await stage("First prepared preview");
  await t.test("a saved bundle is moved, repeat preparation is idempotent and workspace edits cannot change it", async function immutable() {
    await assert.rejects(readFile(join(first.dist, "index.html")), { code: "ENOENT" });
    await mkdir(first.dist);
    await writeFile(join(first.dist, "index.html"), "Later source build");
    assert.equal((await prepareSiteDraft(first.draft.build_id, first.dist, database)).build_id, first.draft.build_id);
    assert.equal((await readDraftFile(first.draft, ["index.html"]))?.toString(), "First prepared preview");
    await verifySiteDraft(first.draft);
    assert.equal((await publicationStatus(owner, project, database))?.live, null);
    assert.equal(await publicationStatus("different-owner", project, database), null);
  });
  await t.test("preview links expire, reject tampering, and are scoped to one saved version", async function capabilities() {
    const now = Date.now();
    const token = new URL(draftPreviewUrl(first.draft.build_id, now)).pathname.split("/").at(-2)!;
    assert.equal(validPreviewToken(first.draft.build_id, token, now), true);
    assert.equal(validPreviewToken(randomUUID(), token, now), false);
    assert.equal(validPreviewToken(first.draft.build_id, token, now + 1800_000), false);
    assert.equal(validPreviewToken(first.draft.build_id, token.slice(0, -1) + "!", now), false);
    assert.equal(await readDraftFile(first.draft, ["..", "index.html"]), null);
    assert.equal(await readDraftFile(first.draft, ["constructor"]), null);
  });
  await t.test("double clicks record one job and concurrent workers publish it once", async function idempotent() {
    await assert.rejects(requestPublication("stranger", project, first.draft.build_id, database), { status: 404 });
    await Promise.all(Array.from({ length: 8 }, () => requestPublication(owner, project, first.draft.build_id, database)));
    assert.equal((await database.query("select count(*)::int n from site_publications")).rows[0].n, 1);
    await Promise.all([runPublicationOnce(new AbortController().signal, database), runPublicationOnce(new AbortController().signal, database)]);
    const status = await publicationStatus(owner, project, database);
    assert.equal(status?.job?.state, "published");
    assert.equal(status?.live?.buildId, first.draft.build_id);
    assert.equal(requests, 1);
    await requestPublication(owner, project, first.draft.build_id, database);
    await runPublicationOnce(new AbortController().signal, database);
    assert.equal(requests, 1);
  });
  const second = await stage("Second prepared preview");
  await t.test("an edit stays a draft and a failed replacement keeps the previous site", async function rollback() {
    assert.equal((await publicationStatus(owner, project, database))?.live?.buildId, first.draft.build_id);
    await assert.rejects(requestPublication(owner, project, first.draft.build_id, database), { status: 409 });
    await requestPublication(owner, project, second.draft.build_id, database);
    responseStatus = 503;
    await runPublicationOnce(new AbortController().signal, database);
    assert.equal((await publicationStatus(owner, project, database))?.job?.state, "failed");
    assert.equal(await readlink(join(root, "sites", slug, "current")), first.draft.build_id);
    assert.equal((await readDraftFile(second.draft, ["index.html"]))?.toString(), "Second prepared preview");
  });
  await t.test("a restarted publisher reconciles the already switched version before reporting it live", async function replay() {
    responseStatus = 200;
    await requestPublication(owner, project, second.draft.build_id, database);
    await database.query("update site_publications set state='publishing',started_at=clock_timestamp(),attempts=1,previous_release=$2 where build_id=$1", [second.draft.build_id, first.draft.build_id]);
    await mkdir(join(root, "sites", slug, second.draft.build_id), { recursive: true });
    await writeFile(join(root, "sites", slug, second.draft.build_id, "index.html"), "Second prepared preview");
    await rm(join(root, "sites", slug, "current"));
    await symlink(second.draft.build_id, join(root, "sites", slug, "current"));
    assert.equal((await publicationStatus(owner, project, database))?.live?.buildId, first.draft.build_id);
    await runPublicationOnce(new AbortController().signal, database);
    assert.equal((await publicationStatus(owner, project, database))?.live?.buildId, second.draft.build_id);
    assert.equal(await readFile(join(root, "sites", slug, second.draft.build_id, "index.html"), "utf8"), "Second prepared preview");
  });
  await t.test("a manual retry retains rollback identity after an interrupted database confirmation", async function retryAfterConfirmationLoss() {
    await database.query("update site_publications set state='failed',started_at=clock_timestamp(),previous_release=$2 where build_id=$1", [second.draft.build_id, first.draft.build_id]);
    await requestPublication(owner, project, second.draft.build_id, database);
    assert.equal((await publicationStatus(owner, project, database))?.live?.buildId, first.draft.build_id);
    responseStatus = 503;
    await runPublicationOnce(new AbortController().signal, database);
    assert.equal(await readlink(join(root, "sites", slug, "current")), first.draft.build_id);
    responseStatus = 200;
    await requestPublication(owner, project, second.draft.build_id, database);
    await runPublicationOnce(new AbortController().signal, database);
    assert.equal((await publicationStatus(owner, project, database))?.job?.state, "published");
  });
  await t.test("manifest verification rejects changes, added files and symlinks", async function changed() {
    const directory = draftDirectory(second.draft);
    await writeFile(join(directory, "injected.js"), "unrecorded");
    await assert.rejects(verifySiteDraft(second.draft), /changed/);
    await rm(join(directory, "injected.js"));
    await writeFile(join(directory, "index.html"), "Changed content");
    assert.equal(await readDraftFile(second.draft, ["index.html"]), null);
    await assert.rejects(verifySiteDraft(second.draft), /changed/);
    await rm(join(directory, "index.html"));
    await symlink(join(first.dist, "index.html"), join(directory, "index.html"));
    await assert.rejects(verifySiteDraft(second.draft), /links/);
  });
  await t.test("saving across mount boundaries preserves hashes, publication permissions and idempotency", { skip: process.platform !== "linux" }, async function crossDevice() {
    const source = await mkdtemp("/dev/shm/fletch-draft-test-");
    const id = randomUUID();
    try {
      assert.notEqual((await stat(source)).dev, (await stat(root)).dev);
      await database.query("insert into builds(id,user_id,project_id,prompt,status) values($1,$2,$3,'Cross-mount fixture','succeeded')", [id, owner, project]);
      await mkdir(join(source, "assets"));
      await writeFile(join(source, "index.html"), "Cross-mount preview");
      await writeFile(join(source, "assets/app.js"), "window.loaded=true");
      const draft = await prepareSiteDraft(id, source, database);
      await verifySiteDraft(draft);
      assert.equal((await readDraftFile(draft, ["assets", "app.js"]))?.toString(), "window.loaded=true");
      assert.equal((await stat(draftDirectory(draft))).mode & 0o777, 0o755);
      await assert.rejects(stat(source), { code: "ENOENT" });
      assert.equal((await prepareSiteDraft(id, source, database)).build_id, id);
      await requestPublication(owner, project, id, database);
      await runPublicationOnce(new AbortController().signal, database);
      assert.equal((await publicationStatus(owner, project, database))?.job?.state, "published");
      assert.equal((await stat(join(root, "sites", slug, id))).mode & 0o005, 0o005);
    } finally { await rm(source, { recursive: true, force: true }); }
  });
});
