import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { analyseNeeds } from "@/lib/agent/needs-analysis";
import { BuildBriefError, needsAnalysisContext, referencedBriefNames } from "@/lib/agent/needs-context";
import type { ProviderConfig } from "@/lib/agent/provider";
import { MAX_TEXT_BYTES } from "./attachments";
import { recoverBuildBrief } from "./recover-brief";
import type { BuildAttachment, BuildInput } from "./types";

const provider: ProviderConfig = { id: "kimi", baseUrl: "https://unused.invalid", apiKey: "unused-fixture", model: "fixture", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true };
const launchpad = "A factory creates ERC-20 tokens and bonding curves. Users connect a wallet, deposit, buy, sell and withdraw fees. END-OF-SAVED-BRIEF";

test("a named brief cannot reach planning without its complete submitted contents", async function () {
  assert.deepEqual(referencedBriefNames("Read `brief/pasted-brief.txt` and brief/My plan.md in full."), ["pasted-brief.txt", "My plan.md"]);
  let requests = 0;
  await assert.rejects(analyseNeeds(provider, { prompt: "Read brief/pasted-brief.txt in full and use it as the build brief." }, false, async function forbidden() {
    requests++;
    throw new Error("An incomplete brief must never reach the model");
  }), BuildBriefError);
  assert.equal(requests, 0);
});

test("saved briefs recover before planning from scoped immutable submissions", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `brief_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, options: `-c search_path=${namespace}` });
  t.after(async function cleanup() { await database.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await database.query("create table projects(id text primary key,user_id text not null)");
  await database.query("create table builds(id text primary key,user_id text,project_id text,prompt text,attachments jsonb,created_at timestamptz,started_at timestamptz)");
  await database.query("create table audit_log(id text primary key,user_id text,resource_id text,action text,metadata jsonb,created_at timestamptz)");
  await database.query("insert into projects values('project','owner'),('other-project','other-owner')");

  async function submission(id: string, minute: number, attachments: BuildAttachment[], owner = "owner", project = "project", started = true): Promise<void> {
    await database.query("insert into builds values($1,$2,$3,$4,$5,$6,$7)", [id, owner, project, "Read brief/pasted-brief.txt in full and use it as the build brief.", JSON.stringify(attachments), new Date(Date.UTC(2026, 0, 1, 0, minute)), started ? new Date(Date.UTC(2026, 0, 1, 0, minute)) : null]);
  }
  const original = [{ name: "pasted-brief.txt", content: launchpad }];
  await submission("first", 1, original);
  await submission("other", 2, [{ name: "pasted-brief.txt", content: "Other customer's private brief" }], "other-owner", "other-project");
  await submission("queued-edit", 3, [{ name: "pasted-brief.txt", content: "Discarded queued draft" }], "owner", "project", false);
  await submission("retry", 4, []);
  await submission("future", 10, [{ name: "pasted-brief.txt", content: "A later request must not change an earlier accepted build" }]);
  const input: BuildInput = { buildId: "retry", slug: "fixture", prompt: "Read brief/pasted-brief.txt in full and use it as the build brief.", attachments: [], ownerAddress: null };
  const recovered = await recoverBuildBrief(database, input, "owner", "project");
  assert.deepEqual(recovered.attachments, original);
  assert.deepEqual(recovered.restoredBriefs, ["pasted-brief.txt"]);
  assert.deepEqual(input.attachments, [], "the accepted request is retained as submitted");
  let requests = 0;
  const verdict = await analyseNeeds(provider, recovered, false, async function classify(_config, messages) {
    requests++;
    assert.ok(messages[1].content.includes(launchpad));
    assert.match(messages[1].content, /current request takes precedence/);
    return { text: '{"contract":true,"wallet":true,"reason":"The saved brief requires a factory and signed trading."}', usage: null, finishReason: "stop" };
  });
  assert.equal(requests, 1);
  assert.equal(verdict.verdict.contract, true);
  assert.equal(verdict.verdict.wallet, true);

  await t.test("a manual continue also retains the last submitted text brief", async function continuation() {
    const continued = await recoverBuildBrief(database, { ...input, prompt: "Continue the unfinished app." }, "owner", "project");
    assert.deepEqual(continued.attachments, original);
    assert.ok(continued.projectRequests?.includes(input.prompt));
  });
  await t.test("inline objectives and the latest change reach a fresh planner before a short continuation", async function inlineObjective() {
    await database.query("insert into projects values('inline','owner')");
    await submission("inline-first", 1, [], "owner", "inline");
    await submission("inline-change", 2, [], "owner", "inline");
    await submission("inline-retry", 3, [], "owner", "inline");
    await database.query("update builds set prompt=$2 where id=$1", ["inline-first", "Build payroll with token funding and employee withdrawals."]);
    await database.query("update builds set prompt=$2 where id=$1", ["inline-change", "Keep the recipient table and add an owner funding action."]);
    const continued = await recoverBuildBrief(database, { ...input, buildId: "inline-retry", prompt: "Continue from the saved files." }, "owner", "inline");
    const context = needsAnalysisContext(continued);
    assert.match(context, /payroll with token funding/);
    assert.match(context, /add an owner funding action/);
    assert.ok(context.endsWith("Continue from the saved files."));
    assert.equal(continued.projectRequests?.length, 2);
  });
  await t.test("current uploads override saved files with the same name", async function replacement() {
    const changed = { ...input, attachments: [{ name: "pasted-brief.txt", content: "Build a read-only public tracker." }] };
    const result = await recoverBuildBrief(database, changed, "owner", "project");
    assert.deepEqual(result.attachments, changed.attachments);
    assert.equal(result.restoredBriefs, undefined);
  });
  await t.test("a new brief can replace older references without silently bringing them back", async function newScope() {
    const changed = { ...input, prompt: "Use brief/new-plan.md for this change.", attachments: [{ name: "new-plan.md", content: "Replace the old draft with a read-only tracker." }] };
    const result = await recoverBuildBrief(database, changed, "owner", "project");
    assert.deepEqual(result.attachments, changed.attachments);
    assert.doesNotThrow(() => needsAnalysisContext(result));
    assert.equal(result.restoredBriefs, undefined);
  });
  await t.test("a newer submitted version wins over the original", async function version() {
    await submission("replacement", 5, [{ name: "pasted-brief.txt", content: "Second accepted version" }]);
    await submission("retry-second", 6, []);
    const result = await recoverBuildBrief(database, { ...input, buildId: "retry-second" }, "owner", "project");
    assert.equal((result.attachments![0] as { content: string }).content, "Second accepted version");
  });
  await t.test("references can recover an older file alongside a new attachment", async function multiple() {
    const result = await recoverBuildBrief(database, { ...input, attachments: [{ name: "changes.md", content: "Add a funding panel." }] }, "owner", "project");
    assert.deepEqual(result.attachments, [...original, { name: "changes.md", content: "Add a funding panel." }]);
  });
  await t.test("other accounts and project IDs cannot recover a brief", async function ownership() {
    for (const [owner, project] of [["other-owner", "project"], ["owner", "other-project"]]) {
      const result = await recoverBuildBrief(database, input, owner, project);
      assert.deepEqual(result.attachments, []);
      assert.throws(() => needsAnalysisContext(result), BuildBriefError);
    }
  });
  await t.test("missing references, oversized saved files and old images fail explicitly", async function unavailable() {
    const missing = await recoverBuildBrief(database, { ...input, prompt: "Read brief/missing.md." }, "owner", "project");
    assert.throws(() => needsAnalysisContext(missing), /brief\/missing.md/);
    await submission("oversize", 7, [{ name: "large.md", content: "x".repeat(MAX_TEXT_BYTES + 1) }]);
    await submission("image", 8, [{ kind: "image", name: "reference.png", mediaType: "image/png", data: "iVBORw0KGgo=" }]);
    await submission("retry-last", 9, []);
    await assert.rejects(recoverBuildBrief(database, { ...input, buildId: "retry-last", prompt: "Use brief/large.md." }, "owner", "project"), BuildBriefError);
    await assert.rejects(recoverBuildBrief(database, { ...input, buildId: "retry-last", prompt: "Use brief/reference.png." }, "owner", "project"), /Restore the original draft/);
  });
});
