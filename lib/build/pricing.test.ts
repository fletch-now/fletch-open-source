import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { PricingPolicySchema, packageSnapshot, pricingDigest, quotedTotal, type PricingPolicy } from "./pricing-policy";

const policy: PricingPolicy = {
  schemaVersion: 1, chainId: 46630, mode: "fixed_packages",
  tiers: {
    small: { credits: 2, allowance: { modelRequests: 2, toolRuns: 2, activeSeconds: 60, maxAgentStepsPerTurn: 2 } },
    medium: { credits: 4, allowance: { modelRequests: 4, toolRuns: 4, activeSeconds: 120, maxAgentStepsPerTurn: 2 } },
    large: { credits: 6, allowance: { modelRequests: 6, toolRuns: 6, activeSeconds: 180, maxAgentStepsPerTurn: 2 } },
  }, quoteLifetimeSeconds: 60, approvalWindowSeconds: 300, maxPackages: 3, refund: "full_refund_on_failure_or_stop",
};
test("fixed package terms reject mainnet, fractional prices and unbounded allowances; BYOK stays zero", function validation() {
  assert.equal(PricingPolicySchema.safeParse({ ...policy, chainId: 4663 }).success, false);
  assert.equal(PricingPolicySchema.safeParse({ ...policy, tiers: { ...policy.tiers, small: { ...policy.tiers.small, credits: 1.2 } } }).success, false);
  assert.equal(PricingPolicySchema.safeParse({ ...policy, tiers: { ...policy.tiers, small: { ...policy.tiers.small, allowance: { ...policy.tiers.small.allowance, modelRequests: 0 } } } }).success, false);
  const snapshot = packageSnapshot({ version: "fixture", digest: pricingDigest(policy), publishedAt: new Date().toISOString(), publishedBy: "fixture", policy }, "small", true);
  assert.equal(snapshot.fixedCredits, 0);
  assert.equal(snapshot.providerCost, "unknown_provider_billed");
  assert.equal(quotedTotal(snapshot, 3).credits, 0);
  assert.throws(() => quotedTotal(snapshot, 4), /limit/);
});

test("pricing admission, accounting and explicit saved-progress extensions use real isolated transactions", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `pricing_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.FORGE_BUILD_EXECUTION = "worker";
  process.env.MOONSHOT_API_KEY = "fixture-never-dispatched";
  const root = await mkdtemp(join(tmpdir(), "fletch-pricing-"));
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  const { pool, close } = await import("@/lib/db");
  t.after(async function cleanup() { await close();await admin.query(`drop schema ${namespace} cascade`);await admin.end();await rm(root, { recursive: true, force: true }); });
  const tables = ["user", "builds", "projects", "credit_events", "build_logs", "app_settings", "audit_log", "user_model_keys", "model_gateways"];
  for (const name of tables) await pool.query(`create table "${name}" (like public."${name}" including all)`);
  for (const [type, table, column] of [["build_status", "builds", "status"], ["credit_reason", "credit_events", "reason"]]) {
    const values = (await admin.query("select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=$1 order by e.enumsortorder", [type])).rows.map(row => `'${row.enumlabel}'`).join(",");
    await pool.query(`create type ${namespace}.${type} as enum (${values})`);
    await pool.query(`alter table ${table} alter column ${column} drop default`);
    await pool.query(`alter table ${table} alter column ${column} type ${namespace}.${type} using ${column}::text::${namespace}.${type}`);
  }
  await pool.query("alter table builds alter column status set default 'queued'");
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  await pool.query(await readFile("drizzle/0057_build_pricing.sql", "utf8"));
  const { createBuildWithCredit } = await import("./create");
  const { issueBuildQuote } = await import("./pricing-quotes");
  const { savePricingDraft, publishPricingDraft } = await import("@/lib/admin/pricing");
  const { guardBuildAllowance, recordBuildActiveSeconds, readBuildAllowance, settleBuildPricing } = await import("./pricing-budget");
  const { issueExtensionQuote, acceptExtensionQuote } = await import("./pricing-extensions");
  const { createSourceCheckpoint } = await import("./durable/checkpoints");
  async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try { await client.query("begin");const value = await fn(client);await client.query("commit");return value; }
    catch (error) { await client.query("rollback");throw error; }
    finally { client.release(); }
  }
  async function account(credits = 10): Promise<string> {
    const id = randomUUID();
    await pool.query('insert into "user"(id,name,email) values($1,\'Fixture\',$2)', [id, `${id}@fixture.invalid`]);
    await pool.query("insert into credit_events(id,user_id,delta,reason,idempotency_key) values($1,$2,$3,'admin_adjust',$1)", [randomUUID(), id, credits]);
    return id;
  }
  const prompt = "Build a controlled allowance fixture";
  const input = { prompt, selection: { billingMode: "platform" as const }, tier: "small" as const };
  async function quoteFor(user: string) {
    return await issueBuildQuote(user, input) as { id: string; digest: string; fixedCredits: number; policyVersion: string };
  }
  async function accepted(user: string) {
    const quote = await quoteFor(user);
    const approval = { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() };
    const build = await createBuildWithCredit(user, prompt, [], input.selection, approval);
    assert.ok(build);return { ...build, quote, approval };
  }
  await t.test("unpublished policy preserves the original one-credit admission", async function legacy() {
    const user = await account(1);
    assert.deepEqual(await issueBuildQuote(user, input), { legacy: true, credits: 1 });
    const build = await createBuildWithCredit(user, prompt);
    assert.ok(build);
    assert.equal((await pool.query("select delta,reason from credit_events where build_id=$1", [build.buildId])).rows[0].reason, "build_debit");
    assert.equal((await tx(client => readBuildAllowance(client, build.buildId))).legacy, true);
  });
  const actor = { userId: null, name: "fixture-console" };
  const draft = await savePricingDraft(actor, policy, null, 0);
  await t.test("publication requires the exact reviewed draft and leaves immutable audited history", async function publish() {
    await assert.rejects(publishPricingDraft(actor, { id: draft.id, revision: 0, digest: draft.digest, expectedActive: null, reason: "fixture" }), /changed/);
    const published = await publishPricingDraft(actor, { ...draft, expectedActive: null, reason: "Controlled policy fixture" });
    assert.equal(published.publishedBy, "fixture-console");
    await assert.rejects(pool.query("update app_settings set value='{}' where key=$1", [`build.pricing.policy.${published.version}`]), /immutable/);
    await assert.rejects(publishPricingDraft(actor, { ...draft, expectedActive: null, reason: "stale concurrent publication" }), /active policy changed/);
    assert.equal((await pool.query("select count(*)::int n from audit_log where action='admin.pricing.publish'")).rows[0].n, 1);
  });
  await t.test("same approved request is idempotent under parallel admission and reserves only the last two credits", async function concurrent() {
    const user = await account(2), quote = await quoteFor(user);
    const approval = { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() };
    const results = await Promise.all([createBuildWithCredit(user, prompt, [], input.selection, approval), createBuildWithCredit(user, prompt, [], input.selection, approval)]);
    assert.ok(results[0]);assert.equal(results[0].buildId, results[1]?.buildId);
    const ledger = (await pool.query("select count(*)::int n,sum(delta)::int amount from credit_events where user_id=$1 and reason='build_reserve'", [user])).rows[0];
    assert.deepEqual(ledger, { n: 1, amount: -2 });
    await assert.rejects(createBuildWithCredit(user, prompt, [], input.selection, { ...approval, digest: "0".repeat(64) }), /another agreement/);
    await assert.rejects(pool.query("update builds set pricing_snapshot='{}' where id=$1", [results[0].buildId]), /immutable/);
  });
  await t.test("tampered and stale payload quotes never reserve credits", async function tamper() {
    const user = await account(), quote = await quoteFor(user);
    await assert.rejects(createBuildWithCredit(user, `${prompt} changed`, [], input.selection, { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() }), /changed/);
    process.env.FORGE_BUILD_EXECUTION = "legacy";
    try { await assert.rejects(createBuildWithCredit(user, prompt, [], input.selection, { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() }), /budget-enabled worker/); }
    finally { process.env.FORGE_BUILD_EXECUTION = "worker"; }
    await assert.rejects(createBuildWithCredit(user, prompt, [], input.selection, { quoteId: quote.id, digest: "f".repeat(64), requestId: randomUUID() }), /quote changed/);
    assert.equal((await pool.query("select count(*)::int n from build_budget_authorizations where user_id=$1", [user])).rows[0].n, 0);
  });
  await t.test("expired quotes, BYOK zero and queued cancellation preserve their separate agreements", async function boundaries() {
    const user = await account(), quote = await quoteFor(user);
    const expired = randomUUID();
    await pool.query("insert into build_pricing_quotes(id,user_id,fingerprint,digest,snapshot,expires_at) select $1,user_id,fingerprint,digest,snapshot,clock_timestamp()-interval '1 second' from build_pricing_quotes where id=$2", [expired, quote.id]);
    await assert.rejects(createBuildWithCredit(user, prompt, [], input.selection, { quoteId: expired, digest: quote.digest, requestId: randomUUID() }), /expired/);
    const ownUser = await account(0), key = randomUUID();
    await pool.query("insert into user_model_keys(id,user_id,provider,model,key_prefix,encrypted_key) values($1,$2,'kimi','kimi-k3','fixture','never-decrypted')", [key, ownUser]);
    const selection = { billingMode: "own_key" as const, custodyMode: "hosted" as const, provider: "kimi" as const, model: "kimi-k3", credentialId: key, credentialVersion: 1 };
    const ownQuote = await issueBuildQuote(ownUser, { ...input, selection }) as { id: string; digest: string; fixedCredits: number };
    assert.equal(ownQuote.fixedCredits, 0);
    const ownBuild = await createBuildWithCredit(ownUser, prompt, [], selection, { quoteId: ownQuote.id, digest: ownQuote.digest, requestId: randomUUID() });
    assert.ok(ownBuild);
    await tx(client => settleBuildPricing(client, ownBuild.buildId, "failed"));
    assert.equal((await pool.query("select count(*)::int n from credit_events where build_id=$1", [ownBuild.buildId])).rows[0].n, 0);
    const queued = await accepted(await account());
    const { cancelQueuedBuild } = await import("./queue");
    const owner = (await pool.query("select user_id from builds where id=$1", [queued.buildId])).rows[0].user_id;
    assert.equal((await cancelQueuedBuild(queued.buildId, owner))?.refunded, true);
    assert.equal(await cancelQueuedBuild(queued.buildId, owner), null);
    assert.equal((await pool.query("select sum(delta)::int n from credit_events where build_id=$1", [queued.buildId])).rows[0].n, 0);
  });
  await t.test("an unexpired issued quote keeps its policy price after an audited publication", async function oldQuote() {
    const user = await account(), quote = await quoteFor(user);
    const active = JSON.parse((await pool.query("select value from app_settings where key='build.pricing.active'")).rows[0].value);
    const changed = { ...policy, tiers: { ...policy.tiers, small: { ...policy.tiers.small, credits: 3 } } };
    const next = await savePricingDraft(actor, changed, null, 0);
    await publishPricingDraft(actor, { ...next, expectedActive: active.version, reason: "Changed fixture price" });
    const build = await createBuildWithCredit(user, prompt, [], input.selection, { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() });
    assert.ok(build);
    assert.equal((await pool.query("select sum(delta)::int n from credit_events where build_id=$1", [build.buildId])).rows[0].n, -2);
    const current = JSON.parse((await pool.query("select value from app_settings where key='build.pricing.active'")).rows[0].value);
    await publishPricingDraft(actor, { ...draft, expectedActive: current.version, reason: "Restore fixture prices as new policy" });
  });
  await t.test("dispatch reservations serialize limits, receipts are immutable, and failure releases once", async function budget() {
    const user = await account(), build = await accepted(user);
    const results = await Promise.all(["a", "b", "c"].map(key => tx(client => guardBuildAllowance(client, build.buildId, key, "model_request"))));
    assert.equal(results.filter(row => row.allowed).length, 2);
    assert.equal(results.filter(row => !row.allowed)[0].reason, "model_requests");
    const firstKey = (await pool.query("select effect_key from build_budget_usage where build_id=$1 limit 1", [build.buildId])).rows[0].effect_key;
    assert.equal((await tx(client => guardBuildAllowance(client, build.buildId, firstKey, "model_request"))).allowed, true);
    await tx(client => recordBuildActiveSeconds(client, build.buildId, "segment", 60));
    assert.equal((await tx(client => guardBuildAllowance(client, build.buildId, "tool", "tool_run"))).reason, "active_time");
    await assert.rejects(tx(client => recordBuildActiveSeconds(client, build.buildId, "segment", 59)), /Conflicting/);
    await Promise.all([tx(client => settleBuildPricing(client, build.buildId, "failed")), tx(client => settleBuildPricing(client, build.buildId, "stopped"))]);
    assert.equal((await pool.query("select sum(delta)::int net from credit_events where build_id=$1", [build.buildId])).rows[0].net, 0);
    assert.equal((await pool.query("select count(*)::int n from credit_events where build_id=$1 and reason='build_release'", [build.buildId])).rows[0].n, 1);
    await assert.rejects(pool.query("delete from build_budget_usage where build_id=$1", [build.buildId]), /immutable/);
  });
  await t.test("successful fixed package consumes its reservation without a second debit", async function success() {
    const user = await account(), build = await accepted(user);
    await tx(client => settleBuildPricing(client, build.buildId, "succeeded"));
    await tx(client => settleBuildPricing(client, build.buildId, "succeeded"));
    assert.deepEqual((await pool.query("select charged_credits,released_credits from build_pricing_settlements where build_id=$1", [build.buildId])).rows[0], { charged_credits: 2, released_credits: 0 });
    assert.equal((await pool.query("select count(*)::int n,sum(delta)::int amount from credit_events where build_id=$1", [build.buildId])).rows[0].amount, -2);
  });
  async function pause(buildId: string, pausedAt = new Date()): Promise<void> {
    const workspace = join(root, buildId), session = join(root, `${buildId}-session`);
    await mkdir(workspace);await mkdir(session);
    await writeFile(join(workspace, "Saved.sol"), "saved customer source");
    await writeFile(join(session, "continuation.json"), JSON.stringify({ session: { sessionId: "fixture-session", files: {} }, context: { phase: "initial_agent" } }));
    const options = { archiveRoot: process.env.FORGE_CHECKPOINT_ROOT!, buildId, attempt: 1, assertQuiescent: async function safe() {} };
    const source = await createSourceCheckpoint({ ...options, workspace, stage: "agent_continuation" });
    const saved = await createSourceCheckpoint({ ...options, workspace: session, stage: "kimi_0_39_1_clean_step" });
    await pool.query("update builds set status='paused',error=null,sandbox_id=null where id=$1", [buildId]);
    await pool.query("update build_worker_jobs set state='paused_budget',checkpoint_hash=$2,last_seq=2 where build_id=$1", [buildId, source.hash]);
    await pool.query("insert into build_worker_events(build_id,seq,attempt,kind,detail,created_at) values($1,1,1,'agent_continuation',$2,clock_timestamp()),($1,2,1,'budget_paused','{}',$3)", [buildId, { sourceHash: source.hash, sessionHash: saved.hash, sessionId: "fixture-session", operations: 1 }, pausedAt]);
  }
  await t.test("extension review does not charge; explicit replay-safe acceptance raises only the approved fixed maximum", async function extension() {
    const user = await account(), build = await accepted(user);
    await pause(build.buildId);
    const quote = await issueExtensionQuote(user, build.buildId) as { id: string; digest: string; approvedMaximum: number };
    assert.equal(quote.approvedMaximum, 4);
    assert.equal((await pool.query("select count(*)::int n from build_budget_authorizations where build_id=$1", [build.buildId])).rows[0].n, 1);
    const approval = { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() };
    process.env.FORGE_BUILD_EXECUTION = "legacy";
    try {
      await assert.rejects(issueExtensionQuote(user, build.buildId), /budget-enabled worker/);
      await assert.rejects(acceptExtensionQuote(user, build.buildId, approval), /budget-enabled worker/);
    } finally { process.env.FORGE_BUILD_EXECUTION = "worker"; }
    const results = await Promise.all([acceptExtensionQuote(user, build.buildId, approval), acceptExtensionQuote(user, build.buildId, approval)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await pool.query("select state from build_worker_jobs where build_id=$1", [build.buildId])).rows[0].state, "queued");
    assert.equal((await pool.query("select sum(delta)::int n from credit_events where build_id=$1", [build.buildId])).rows[0].n, -4);
    await tx(client => settleBuildPricing(client, build.buildId, "failed"));
    assert.equal((await pool.query("select sum(delta)::int n from credit_events where build_id=$1", [build.buildId])).rows[0].n, 0);
  });
  await t.test("an expired clean pause and insufficient balance cannot buy or queue another package", async function expiry() {
    const user = await account(), expired = await accepted(user);
    await pause(expired.buildId, new Date(Date.now() - 301_000));
    await assert.rejects(issueExtensionQuote(user, expired.buildId), /approval window has ended/);
    const emptyUser = await account(2), empty = await accepted(emptyUser);
    await pause(empty.buildId);
    const quote = await issueExtensionQuote(emptyUser, empty.buildId) as { id: string; digest: string };
    await assert.rejects(acceptExtensionQuote(emptyUser, empty.buildId, { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() }), /enough credits/);
    assert.equal((await pool.query("select state from build_worker_jobs where build_id=$1", [empty.buildId])).rows[0].state, "paused_budget");
    assert.equal((await pool.query("select count(*)::int n from build_budget_authorizations where build_id=$1", [empty.buildId])).rows[0].n, 1);
  });
  await t.test("deleting a finished project preserves immutable quotes, receipts and credit evidence", async function deletion() {
    const user = await account(), build = await accepted(user);
    await pool.query("update builds set status='succeeded' where id=$1", [build.buildId]);
    await pool.query("update build_worker_jobs set state='completed' where build_id=$1", [build.buildId]);
    await tx(client => settleBuildPricing(client, build.buildId, "succeeded"));
    await issueBuildQuote(user, { ...input, projectId: build.projectId });
    const quoteRows = (await pool.query("select * from build_pricing_quotes where user_id=$1 order by id", [user])).rows;
    process.env.FORGE_WORKSPACE_ROOT = join(root, "deletion-workspaces");
    process.env.FORGE_SITES_ROOT = join(root, "deletion-sites");
    const { deleteProject } = await import("@/lib/projects/delete");
    assert.equal((await deleteProject(user, build.projectId))?.ok, true);
    assert.deepEqual((await pool.query("select * from build_pricing_quotes where user_id=$1 order by id", [user])).rows, quoteRows);
    assert.equal((await pool.query("select count(*)::int n from build_pricing_settlements where build_id=$1", [build.buildId])).rows[0].n, 1);
  });
  await t.test("Stop or unknown external work prevents extension and leaves ledger untouched", async function stopped() {
    const user = await account(), build = await accepted(user);
    await pause(build.buildId);
    const quote = await issueExtensionQuote(user, build.buildId) as { id: string; digest: string };
    await pool.query("update build_worker_jobs set stop_requested_at=clock_timestamp() where build_id=$1", [build.buildId]);
    await assert.rejects(acceptExtensionQuote(user, build.buildId, { quoteId: quote.id, digest: quote.digest, requestId: randomUUID() }), /cannot accept/);
    assert.equal((await pool.query("select count(*)::int n from build_budget_authorizations where build_id=$1", [build.buildId])).rows[0].n, 1);
    const other = await accepted(await account());await pause(other.buildId);
    await pool.query("insert into build_worker_effects(build_id,effect_key,attempt,kind,checkpoint_hash) values($1,'unknown',1,'model','fixture')", [other.buildId]);
    await assert.rejects(issueExtensionQuote((await pool.query("select user_id from builds where id=$1", [other.buildId])).rows[0].user_id, other.buildId), /reconciliation/);
  });
});
