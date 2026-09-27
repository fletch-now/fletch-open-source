import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { withWorkerExecution, workerOperation, workerEvents } from "@/lib/build/durable/execution";
import { beginWorkerEffect, claimWorkerBuild, enrollWorkerBuild, recordWorkerCheckpoint, type WorkerClaim } from "@/lib/build/durable/ownership";
import { buildSignal } from "@/lib/build/cancellation";
import { friendlyAgentFailure } from "./cli-failure";
import { encryptCredential } from "./credential-secret";
import type { CredentialLease } from "./credential-proxy";
import type { ProviderConfig } from "./provider";
import { CODE_SIMPLIFIER_STANDARD } from "./code-simplifier";

const SUMMARY_PROMPT = "You are about to run out of context. Write a first-person handoff note to\nyourself\n--- This message is a direct task, not part of the above conversation ---\nRespond with text only. Do not call any tools";

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>(function deadline(_resolve, reject) {
      timeout = setTimeout(() => reject(new Error(message)), 7000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
}

test("worker proxy fences paid requests and observes credentials changed by another connection", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
  timeout: 180_000,
}, async function workerProxy(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL!;
  const namespace = `proxy_worker_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`create schema ${namespace}`);
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set("options", `-c search_path=${namespace}`);
  const previous = { DATABASE_URL: process.env.DATABASE_URL, FORGE_PROXY_BIND: process.env.FORGE_PROXY_BIND, FORGE_PROXY_PORT: process.env.FORGE_PROXY_PORT,
    FORGE_WORKSPACE_ROOT: process.env.FORGE_WORKSPACE_ROOT, FORGE_CHECKPOINT_ROOT: process.env.FORGE_CHECKPOINT_ROOT, MODEL_CREDENTIAL_KEY: process.env.MODEL_CREDENTIAL_KEY,
    MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY, FORGE_MAX_CONCURRENT_BUILDS: process.env.FORGE_MAX_CONCURRENT_BUILDS };
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-worker-proxy-")));
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  process.env.MODEL_CREDENTIAL_KEY = "fixture-encryption-key-not-used-outside-this-test";
  process.env.MOONSHOT_API_KEY = "loopback-fixture-only";
  process.env.FORGE_MAX_CONCURRENT_BUILDS = "1";
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.FORGE_PROXY_BIND = "127.0.0.1";
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  process.env.FORGE_PROXY_PORT = String((reserve.address() as AddressInfo).port);
  await closeServer(reserve);
  const { pool, close } = await import("@/lib/db");
  const { leaseCredential, closeCredentialProxy, revokeWorkerCredentials } = await import("./credential-proxy");
  const { runBuildWorkerOnce, reconcileLostBuildWorkers } = await import("@/lib/build/durable/runner");
  const { verifySourceCheckpoint } = await import("@/lib/build/durable/checkpoints");
  const { runWorkerOnce } = await import("@/lib/build/durable/worker");
  const leases: CredentialLease[] = [];
  let mode: "reply" | "lost" | "hang" | "output-limit" | "incomplete-tool" | "http-error" | "rate-limit-once" | "summary" | "bad-summary" = "reply";
  let httpStatus = 429;
  let requests = 0;
  const received: string[] = [];
  let reached: (() => void) | undefined;
  let disconnected: (() => void) | undefined;
  const upstream = createServer(async function receive(req, res) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push(Buffer.concat(chunks).toString("utf8"));
    requests += 1;
    res.once("close", () => disconnected?.());
    reached?.();
    if (mode === "lost") { res.destroy(); return; }
    if (mode === "hang") return;
    if (mode === "rate-limit-once" && requests === 1) { res.writeHead(429, { "retry-after": "0" }); res.end(); return; }
    if (mode === "http-error") { res.writeHead(httpStatus, { "retry-after": "120" }); res.end("untrusted upstream details"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    if (mode === "output-limit" || mode === "incomplete-tool") {
      res.end(JSON.stringify({ id: "known-output-response", choices: [{ message: { role: "assistant", tool_calls: [
        { id: "write", function: { name: "write_file", arguments: '{"path":"App.tsx","content":"' + "x".repeat(20_000) } },
      ] }, finish_reason: mode === "output-limit" ? "length" : "tool_calls" }], usage: { prompt_tokens: 120, completion_tokens: 8192 } }));
      return;
    }
    const content = mode === "summary" ? "Keep the forest theme. Tests passed in the last observed run. The stylesheet is unfinished." : "fixture response";
    res.end(JSON.stringify({ id: "fixture-response", choices: [{ message: { role: "assistant", content }, finish_reason: mode === "bad-summary" ? "length" : "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
  });
  t.after(async function cleanup() {
    for (const lease of leases) lease.release();
    await closeCredentialProxy();
    await closeServer(upstream);
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const table of ["audit_log", "builds", "build_logs", "credit_events", "projects", "contracts", "wallet_address", "app_settings", "user_model_keys"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  const body = { model: "fixture-model", messages: [{ role: "user", content: "controlled fixture" }], stream: false };

  async function enroll(): Promise<void> {
    await pool.query("truncate build_worker_events,build_worker_effects,build_worker_jobs,builds,build_logs,credit_events,projects,contracts,user_model_keys");
    await pool.query("insert into projects(id,user_id,slug,name) values('fixture','owner','fixture','Fixture')");
    await pool.query("insert into builds(id,project_id,user_id,prompt,billing_mode,custody_mode,provider,model,credential_id,credential_version) values('fixture','fixture','owner','Fixture','own_key','hosted','kimi','fixture-model','fixture-key',1)");
    await pool.query("insert into user_model_keys(id,user_id,provider,model,version,key_prefix,encrypted_key) values('fixture-key','owner','kimi','fixture-model',1,'fixture',$1)",
      [encryptCredential("local-fixture-only", JSON.stringify(["owner", "kimi", "fixture-key", 1]))]);
    await enrollWorkerBuild(pool, "fixture");
    requests = 0;
    received.length = 0;
    reached = undefined;
    disconnected = undefined;
  }

  let latestClaim: WorkerClaim | undefined;
  async function freshLease(): Promise<CredentialLease> {
    await enroll();
    const claim = await claimWorkerBuild(pool, "fixture-worker", 300_000);
    assert.ok(claim);
    latestClaim = claim;
    await recordWorkerCheckpoint(pool, claim, "a".repeat(64));
    await beginWorkerEffect(pool, claim, "1:agent-turn", "model");
    const provider: ProviderConfig = {
      id: "kimi", model: body.model, apiKey: "local-fixture-only", baseUrl, bringYourOwnKey: true,
      credentialId: "fixture-key", credentialVersion: 1, ownerId: "owner", buildId: "fixture", inputPerMTok: 0, outputPerMTok: 0,
    };
    const lease = await withWorkerExecution({
      pool, claim, signal: new AbortController().signal, workspace: "/unused", archiveRoot: "/unused",
      nextOperation: 1, activeKey: "1:agent-turn", containers: new Set(),
    }, () => leaseCredential(provider, "local"));
    leases.push(lease);
    return lease;
  }

  function call(lease: CredentialLease, prompt = body.messages[0].content): Promise<Response> {
    return fetch(`${lease.baseUrl}/chat/completions`, {
      method: "POST", headers: { authorization: `Bearer ${lease.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(12_000),
    });
  }

  await t.test("an existing completed request intent rejects an identical replay without a second dispatch", async function duplicate() {
    const lease = await freshLease();
    mode = "reply";
    try {
      assert.equal((await call(lease)).status, 200);
      assert.equal((await call(lease)).status, 400);
      assert.equal(requests, 1);
      const effects = await pool.query("select state,receipt from build_worker_effects where effect_key <> '1:agent-turn'");
      assert.equal(effects.rows.length, 1);
      assert.equal(effects.rows[0].state, "completed");
      assert.equal(effects.rows[0].receipt.providerRequestId, "fixture-response");
      assert.deepEqual(effects.rows[0].receipt.usage, { inputTokens: 12, outputTokens: 3 });
    } finally { lease.release(); }
  });

  await t.test("native compaction persists a complete summary and streams progress with metered usage", async function summarize() {
    const lease = await freshLease();
    mode = "summary";
    try {
      const response = await fetch(`${lease.baseUrl}/chat/completions`, {
        method: "POST", headers: { authorization: `Bearer ${lease.token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...body, messages: [{ role: "user", content: "Use the forest theme" }, { role: "user", content: SUMMARY_PROMPT }],
          tools: [{ type: "function", function: { name: "Read", parameters: {} } }] }),
      });
      assert.equal(response.status, 200);
      const sent = JSON.parse(received[0]);
      assert.equal(sent.tools, undefined, "Summary requests cannot dispatch tools");
      assert.equal(sent.max_tokens, 16_384);
      assert.deepEqual(sent.messages[0], { role: "system", content: CODE_SIMPLIFIER_STANDARD });
      assert.equal(sent.messages[1].content, "Use the forest theme");
      const summaries = await pool.query("select detail from build_worker_events where kind='context_summary'");
      assert.equal(summaries.rows.length, 1);
      assert.match(summaries.rows[0].detail.summary, /stylesheet is unfinished/);
      const logs = await pool.query("select chunk from build_logs order by seq");
      assert.match(logs.rows[0].chunk, /Summarizing the conversation/);
      assert.match(logs.rows[1].chunk, /Conversation summary saved/);
      const { workerStream } = await import("@/lib/build/durable/stream");
      const reader = workerStream(pool, "fixture", new AbortController().signal, null,
        event => [new TextEncoder().encode(event.text)]).body!.getReader();
      const first = await reader.read(); const second = await reader.read(); await reader.cancel();
      assert.match(new TextDecoder().decode(first.value), /Summarizing/);
      assert.match(new TextDecoder().decode(second.value), /summary saved/);
      assert.deepEqual(lease.release(), { inputTokens: 12, outputTokens: 3, requests: 1, reportedRequests: 1 });
    } finally { lease.release(); }
  });

  await t.test("the coding standard is supplied again after compaction and on a new build lease", async function codingStandard() {
    for (const resumed of [false, true]) {
      const lease = await freshLease();
      mode = "reply";
      try {
        assert.equal((await call(lease, resumed ? "Continue the saved task" : "Build a new app")).status, 200);
        mode = "summary";
        assert.equal((await call(lease, SUMMARY_PROMPT)).status, 200);
        mode = "reply";
        assert.equal((await call(lease, "Saved summary: finish the stylesheet. The coding policy was omitted from this summary.")).status, 200);
        assert.equal(requests, 3, "No separate review or policy-fetch model call");
        for (const raw of received) {
          const sent = JSON.parse(raw);
          assert.equal(sent.model, body.model, "The selected model is retained");
          assert.deepEqual(sent.messages[0], { role: "system", content: CODE_SIMPLIFIER_STANDARD });
          assert.equal(sent.messages.filter((message: { content?: string }) => message.content === CODE_SIMPLIFIER_STANDARD).length, 1);
        }
      } finally { lease.release(); }
    }
  });

  await t.test("a truncated summary retains earlier memory and blocks unsafe retries", async function incompleteSummary() {
    const lease = await freshLease();
    mode = "bad-summary";
    await pool.query("insert into build_worker_events(build_id,seq,attempt,kind,detail) values('fixture',-1,1,'context_summary',$1)",
      [JSON.stringify({ summary: "Previous complete memory", logSeq: -1 })]);
    try {
      assert.equal((await call(lease, SUMMARY_PROMPT)).status, 400);
      assert.equal((await call(lease, SUMMARY_PROMPT)).status, 400);
      assert.equal(requests, 1);
      const saved = await pool.query("select detail from build_worker_events where kind='context_summary'");
      assert.deepEqual(saved.rows.map(row => row.detail.summary), ["Previous complete memory"]);
      assert.equal(lease.release().modelFailure, "incomplete_summary");
    } finally { lease.release(); }
  });

  await t.test("Stop cancels an in-flight summary without recording a completed summary", async function stopSummary() {
    const lease = await freshLease();
    mode = "hang";
    const dispatched = new Promise<void>(resolve => { reached = resolve; });
    const response = call(lease, SUMMARY_PROMPT);
    await bounded(dispatched, "Summary did not reach the controlled provider");
    await revokeWorkerCredentials(latestClaim!);
    assert.notEqual((await response).status, 200);
    const saved = await pool.query("select 1 from build_worker_events where kind='context_summary'");
    assert.equal(saved.rows.length, 0);
    lease.release();
  });

  for (const failure of ["output-limit", "incomplete-tool"] as const) {
    await t.test(`a known ${failure} response is receipted without forwarding arguments or retrying its lease`, async function knownOutput() {
      const lease = await freshLease();
      mode = failure;
      const response = await call(lease);
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /App\.tsx|xxxx/);
      assert.equal((await call(lease, "SDK changed retry")).status, 400);
      assert.equal(requests, 1);
      const expected = failure === "output-limit" ? "output_limit" : "incomplete_tool_request";
      assert.deepEqual(lease.release(), { inputTokens: 120, outputTokens: 8192, requests: 1, reportedRequests: 1, modelFailure: expected });
      const effects = await pool.query("select state,receipt from build_worker_effects where effect_key <> '1:agent-turn'");
      assert.deepEqual(effects.rows, [{ state: "completed", receipt: { providerRequestId: "known-output-response", model: body.model,
        usage: { inputTokens: 120, outputTokens: 8192 }, finishReason: failure === "output-limit" ? "length" : "tool_calls",
        outcome: failure === "output-limit" ? "output_limited" : "incomplete_tool_request" } }]);
    });
  }

  for (const finalFailure of [false, true]) {
    await t.test(`known output limit reaches a checkpoint before ${finalFailure ? "specific terminal failure" : "a new receipted turn"}`, async function knownTurn() {
      await enroll();
      await pool.query("update builds set billing_mode='platform',custody_mode='platform' where id='fixture'");
      await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values('known-debit','owner','fixture',-1,'build_debit','build_debit:fixture')");
      const workspace = join(root, "workspaces", "fixture");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "Saved.tsx"), "unchanged saved source after output limit");
      mode = "output-limit";
      let closed = false;
      const outcome = await runBuildWorkerOnce("known-output-worker", { builder(options) {
        assert.ok(options?.provider);
        const provider = options.provider;
        return { async *run() {
          for await (const _event of workerEvents("agent-turn", "model", async function* limited() {
            const lease = await leaseCredential({ ...provider, baseUrl }, "local", buildSignal());
            leases.push(lease);
            assert.equal((await call(lease)).status, 400);
            const usage = lease.release();
            assert.equal(usage.modelFailure, "output_limit");
            options.onCost?.({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usd: 0, model: provider.model });
            yield { phase: "error" as const, text: "Output limited" };
            closed = true;
          })) { void _event; }
          assert.ok(closed);
          const job = (await pool.query("select checkpoint_hash from build_worker_jobs where build_id='fixture'")).rows[0];
          const checkpoint = await verifySourceCheckpoint(join(root, "checkpoints"), job.checkpoint_hash);
          assert.equal(checkpoint.manifest.stage, "after:agent-turn");
          assert.equal((await pool.query("select count(*)::int n from build_worker_effects where state='uncertain'")).rows[0].n, 0);
          if (finalFailure) {
            yield { phase: "error" as const, text: "The model reached its output limit during a tool request. Your source files are saved." };
            return;
          }
          mode = "reply";
          yield* workerEvents("agent-turn", "model", async function* continued() {
            const lease = await leaseCredential({ ...provider, baseUrl }, "local", buildSignal());
            leases.push(lease);
            assert.equal((await call(lease, "fresh controlled continuation")).status, 200);
            const usage = lease.release();
            options.onCost?.({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usd: 0, model: provider.model });
            yield { phase: "note" as const, text: "Controlled continuation completed" };
          });
          yield { phase: "done" as const, text: "Controlled fixture completed" };
        } };
      } });
      assert.equal(outcome, "completed");
      const saved = (await pool.query("select status,error,tokens_in,tokens_out from builds where id='fixture'")).rows[0];
      assert.equal(saved.status, finalFailure ? "failed" : "succeeded");
      if (finalFailure) assert.match(saved.error, /model reached its output limit/);
      assert.equal(saved.tokens_in, finalFailure ? 120 : 132);
      assert.equal(saved.tokens_out, finalFailure ? 8192 : 8195);
      assert.equal(requests, finalFailure ? 1 : 2);
      assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, finalFailure ? 1 : 0);
      assert.equal((await pool.query("select count(*)::int n from build_worker_effects where state='uncertain'")).rows[0].n, 0);
    });
  }

  await t.test("a confirmed throttle retries within the same request and records progress and separate effects", async function rateLimit() {
    const lease = await freshLease();
    mode = "rate-limit-once";
    const response = await call(lease);
    assert.equal(response.status, 200);
    assert.equal(requests, 2);
    assert.equal(received[0], received[1], "Retry preserves every message, tool argument and model selection");
    const effects = await pool.query("select effect_key,state,receipt from build_worker_effects where effect_key <> '1:agent-turn' order by effect_key");
    assert.equal(effects.rows.length, 2);
    assert.equal(effects.rows[0].receipt.httpStatus, 429);
    assert.equal(effects.rows[1].receipt.outcome, "response_received");
    assert.ok(effects.rows.every(row => row.state === "completed"));
    const logs = await pool.query("select chunk from build_logs where build_id='fixture'");
    assert.equal(logs.rows.length, 1);
    assert.match(JSON.parse(logs.rows[0].chunk).text, /Retrying this request.*1\/2/);
    const { workerStream } = await import("@/lib/build/durable/stream");
    const controller = new AbortController();
    const stream = workerStream(pool, "fixture", controller.signal, null,
      event => [new TextEncoder().encode(JSON.stringify(event))]);
    const reader = stream.body!.getReader();
    const frame = await reader.read();
    assert.match(new TextDecoder().decode(frame.value), /Retrying this request.*1\/2/);
    controller.abort();
    await reader.cancel();
    assert.equal((await call(lease)).status, 400);
    assert.equal(requests, 2, "An SDK replay cannot dispatch the accepted request again");
    lease.release();
  });

  for (const status of [401, 402, 403, 429, 503]) {
    await t.test(`HTTP ${status} preserves response evidence without claiming unknown execution completed`, async function rejectedResponse() {
      const lease = await freshLease();
      mode = "http-error";
      httpStatus = status;
      const response = await call(lease);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.message, `The model provider returned ${status}.`);
      assert.equal((await call(lease)).status, 400, "the same request cannot be replayed");
      assert.equal(requests, 1);
      const effect = (await pool.query("select state,receipt from build_worker_effects where effect_key <> '1:agent-turn'")).rows[0];
      if (status === 503) assert.deepEqual(effect, { state: "uncertain", receipt: null });
      else assert.deepEqual(effect, { state: "completed", receipt: { outcome: "provider_rejected", httpStatus: status, retryAfterSeconds: 120, usage: "unknown" } });
      assert.equal(lease.release().reportedRequests, 0);
    });
  }

  await t.test("mapped 429 keeps its CLI failure through checkpoint and exactly one refund", async function rejectedTurn() {
    await enroll();
    await pool.query("update builds set billing_mode='platform',custody_mode='platform' where id='fixture'");
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values('rejection-debit','owner','fixture',-1,'build_debit','build_debit:fixture')");
    const workspace = join(root, "workspaces", "fixture");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "Saved.tsx"), "source saved before rejection");
    mode = "http-error";
    httpStatus = 429;
    const expected = "The model provider rejected the request (HTTP 429). Your source files are saved. Try again later or choose another model connection.";
    const outcome = await runBuildWorkerOnce("rejection-worker", { builder(options) {
      assert.ok(options?.provider);
      const provider = options.provider;
      return { async *run() {
        yield* workerEvents("agent-turn", "model", async function* rejected() {
          const lease = await leaseCredential({ ...provider, baseUrl }, "local", buildSignal());
          leases.push(lease);
          const response = await call(lease);
          assert.equal(response.status, 400);
          const message = (await response.json()).error.message;
          const hint = "See log: /work/.kimi-code/logs/kimi.log";
          const text = friendlyAgentFailure(hint, 1, `provider.api_error: ${response.status} ${message}\n${hint}`);
          assert.equal(text, expected);
          const usage = lease.release();
          assert.equal(usage.reportedRequests, 0);
          options.onCost?.({ inputTokens: 0, outputTokens: 0, usd: 0, model: provider.model, usageComplete: false });
          await writeFile(join(workspace, "Saved.tsx"), "source saved after rejection");
          yield { phase: "error" as const, text };
        });
      } };
    } });
    assert.equal(outcome, "completed");
    assert.equal(requests, 1);
    const saved = (await pool.query("select status,error,tokens_in,tokens_out,cost_usd from builds where id='fixture'")).rows[0];
    assert.deepEqual(saved, { status: "failed", error: expected, tokens_in: null, tokens_out: null, cost_usd: null });
    const job = (await pool.query("select checkpoint_hash,state from build_worker_jobs where build_id='fixture'")).rows[0];
    assert.equal(job.state, "completed");
    const checkpoint = await verifySourceCheckpoint(join(root, "checkpoints"), job.checkpoint_hash);
    assert.equal(checkpoint.manifest.stage, "after:agent-turn");
    assert.equal(await readFile(join(checkpoint.path, "files", "Saved.tsx"), "utf8"), "source saved after rejection");
    const effect = (await pool.query("select state,receipt from build_worker_effects where effect_key like '%:request:%'")).rows[0];
    assert.deepEqual(effect, { state: "completed", receipt: { outcome: "provider_rejected", httpStatus: 429, retryAfterSeconds: 120, usage: "unknown" } });
    await reconcileLostBuildWorkers();
    assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, 1);
    assert.equal((await pool.query("select sum(delta)::int n from credit_events")).rows[0].n, 0);
    assert.equal((await pool.query("select count(*)::int n from build_logs where level='error'")).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int n from build_worker_effects where state='uncertain'")).rows[0].n, 0);
  });

  await t.test("a lost upstream response leaves an uncertain intent and blocks identical or changed retries", async function unknown() {
    const lease = await freshLease();
    mode = "lost";
    try {
      assert.equal((await call(lease)).status, 400);
      mode = "reply";
      assert.equal((await call(lease)).status, 400);
      assert.equal((await call(lease, "changed retry")).status, 400);
      assert.equal(requests, 1);
      const effects = await pool.query("select state,receipt from build_worker_effects where effect_key <> '1:agent-turn'");
      assert.deepEqual(effects.rows, [{ state: "uncertain", receipt: null }]);
      const totals = lease.release();
      assert.equal(totals.requests, 1);
      assert.equal(totals.reportedRequests, 0);
    } finally { lease.release(); }
  });

  await t.test("worker cleanup waits for an in-flight request even after its authentication lease was released", async function releasedWhileReading() {
    const lease = await freshLease();
    assert.ok(latestClaim);
    const claim = latestClaim;
    let resolveResponse: (status: number) => void = () => {};
    let rejectResponse: (cause: Error) => void = () => {};
    const response = new Promise<number>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const request = httpRequest(`${lease.baseUrl}/chat/completions`, {
      method: "POST", headers: { authorization: `Bearer ${lease.token}`, "content-type": "application/json", "content-length": "2" },
    }, (reply) => { reply.resume(); reply.on("end", () => resolveResponse(reply.statusCode ?? 0)); });
    request.on("error", rejectResponse);
    request.write("{");
    await new Promise((resolve) => setTimeout(resolve, 25));
    let cleanup: Promise<void> | undefined;
    try {
      // A concurrent request gets 429 once the first request has reserved the
      // lease while waiting for its remaining body. Invalid probes never dispatch.
      let reserved = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const probe = await fetch(`${lease.baseUrl}/chat/completions`, {
          method: "POST", headers: { authorization: `Bearer ${lease.token}`, "content-type": "application/json" },
          body: JSON.stringify({ ...body, model: "not-the-selected-model" }),
        });
        if (probe.status === 429) { reserved = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(reserved, true);
      await revokeWorkerCredentials({ ...claim, fence: randomUUID() });
      lease.release();
      let cleaned = false;
      cleanup = revokeWorkerCredentials(claim).then(() => { cleaned = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(cleaned, false, "deleting authentication must not hide an unfinished handler");
      request.end("}");
      assert.equal(await bounded(response, "Released request never finished"), 400);
      await bounded(cleanup, "Worker cleanup did not observe the completed handler");
      assert.equal((await call(lease)).status, 401);
      assert.equal(requests, 0);
    } finally {
      request.destroy();
      await response.catch(() => {});
      await cleanup;
      lease.release();
    }
  });

  for (const billingMode of ["platform", "own_key"] as const) {
    await t.test(`${billingMode} lost response fails after cleanup, retains source and frees the next queued claim`, async function failedRequest() {
      await enroll();
      await pool.query("update builds set billing_mode=$1,custody_mode=$2,tokens_in=10,tokens_out=5,cost_usd=0.01 where id='fixture'",
        [billingMode, billingMode === "platform" ? "platform" : "hosted"]);
      await pool.query("update projects set preview_url='https://previous.fixture.invalid' where id='fixture'");
      if (billingMode === "platform") await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values('debit','owner','fixture',-1,'build_debit','build_debit:fixture')");
      await pool.query("insert into projects(id,user_id,slug,name) values('next','owner','next','Next')");
      await pool.query("insert into builds(id,project_id,user_id,prompt,billing_mode,custody_mode,provider,model) values('next','next','owner','Next fixture','platform','platform','kimi','fixture-model')");
      await enrollWorkerBuild(pool, "next");
      const workspace = join(root, "workspaces", "fixture");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "Saved.sol"), "original saved source");
      mode = "lost";
      let lease: CredentialLease | undefined;
      let checkpointHash: string | undefined;
      let checkpointRejected = false;
      const outcome = await runBuildWorkerOnce("failure-worker", { builder(options) {
        assert.ok(options?.provider);
        const provider = options.provider;
        return { async *run() {
          assert.equal(await claimWorkerBuild(pool, "waiting-worker", 30_000, 1), null, "running attempt retains capacity until cleanup");
          try {
            await workerOperation("cli", "model", async function request() {
              checkpointHash = (await pool.query("select checkpoint_hash from build_worker_jobs where build_id='fixture'")).rows[0].checkpoint_hash;
              lease = await leaseCredential({ ...provider, baseUrl }, "local", buildSignal());
              leases.push(lease);
              assert.equal((await call(lease)).status, 400);
              await writeFile(join(workspace, "Saved.sol"), "source retained after interrupted request");
              // Leave this attempt's lease for the actual runner cleanup.
            });
          } catch (cause) {
            assert.match(String(cause), /Cannot checkpoint until the current effect has a receipt/);
            checkpointRejected = true;
            throw cause;
          }
          yield { phase: "done", text: "Must not publish this interrupted run", previewUrl: "https://incorrect.fixture.invalid" };
        } };
      } });
      assert.equal(checkpointRejected, true, "exercise the observed nested-request checkpoint failure");
      assert.equal(outcome, "completed", "confirmed cleanup permits terminal failure instead of a permanent reservation");
      assert.ok(lease);
      assert.equal((await call(lease)).status, 401, "cleaned-up lease cannot dispatch again");
      assert.equal(requests, 1, "unknown upstream outcome is never replayed");
      const build = (await pool.query("select status,tokens_in,tokens_out,cost_usd,sandbox_id,finished_at from builds where id='fixture'")).rows[0];
      assert.equal(build.status, "failed");
      assert.ok(build.finished_at);
      assert.equal(build.sandbox_id, null);
      assert.deepEqual([build.tokens_in, build.tokens_out, build.cost_usd], [null, null, null]);
      const job = (await pool.query("select state,lease_expires_at,checkpoint_hash from build_worker_jobs where build_id='fixture'")).rows[0];
      assert.equal(job.state, "completed");
      assert.equal(job.lease_expires_at, null);
      assert.ok(checkpointHash);
      const checkpoint = await verifySourceCheckpoint(join(root, "checkpoints"), checkpointHash);
      assert.equal(await readFile(join(checkpoint.path, "files", "Saved.sol"), "utf8"), "original saved source");
      const finalCheckpoint = await verifySourceCheckpoint(join(root, "checkpoints"), job.checkpoint_hash);
      assert.equal(await readFile(join(finalCheckpoint.path, "files", "Saved.sol"), "utf8"), "source retained after interrupted request");
      assert.equal(await readFile(join(workspace, "Saved.sol"), "utf8"), "source retained after interrupted request");
      assert.equal((await pool.query("select preview_url from projects where id='fixture'")).rows[0].preview_url, "https://previous.fixture.invalid");
      const child = (await pool.query("select state,receipt from build_worker_effects where build_id='fixture' and effect_key like '%:request:%'")).rows;
      assert.equal(child.length, 1);
      assert.equal(child[0].state, "completed");
      assert.equal(child[0].receipt.outcome, "failed_after_cleanup");
      assert.equal(child[0].receipt.usage, "unknown");
      assert.equal((await pool.query("select count(*)::int n from build_worker_effects where build_id='fixture' and state='uncertain'")).rows[0].n, 0);
      await reconcileLostBuildWorkers();
      assert.equal((await pool.query("select count(*)::int n from credit_events where build_id='fixture' and reason='refund'")).rows[0].n, billingMode === "platform" ? 1 : 0);
      assert.equal((await pool.query("select count(*)::int n from build_logs where build_id='fixture' and level='error'")).rows[0].n, 1);
      assert.equal((await claimWorkerBuild(pool, "next-worker", 30_000, 1))?.buildId, "next");
    });
  }

  await t.test("a CLI-style yielded error with an uncertain child still reaches cleanup and one terminal refund", async function yieldedCliError() {
    await enroll();
    await pool.query("update builds set billing_mode='platform',custody_mode='platform' where id='fixture'");
    await pool.query("update projects set preview_url='https://previous.fixture.invalid' where id='fixture'");
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values('yielded-debit','owner','fixture',-1,'build_debit','build_debit:fixture')");
    const workspace = join(root, "workspaces", "fixture");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "Saved.sol"), "source retained after yielded error");
    mode = "lost";
    let lease: CredentialLease | undefined;
    const outcome = await runBuildWorkerOnce("yielded-error-worker", { builder(options) {
      assert.ok(options?.provider);
      const provider = options.provider;
      return { async *run() {
        yield* workerEvents("agent-turn", "model", async function* cliEvents() {
          lease = await leaseCredential({ ...provider, baseUrl }, "local", buildSignal());
          leases.push(lease);
          assert.equal((await call(lease)).status, 400);
          // The installed CLI reports a failed turn as an event, then exits
          // normally from its async generator. The child receipt is unknown.
          yield { phase: "error" as const, text: "Controlled CLI error event" };
        });
      } };
    } });
    assert.equal(outcome, "completed");
    assert.equal((await pool.query("select status from builds where id='fixture'")).rows[0].status, "failed");
    assert.equal(requests, 1);
    assert.ok(lease);
    assert.equal((await call(lease)).status, 401);
    const receipts = (await pool.query("select state,receipt from build_worker_effects where effect_key like '%:request:%'")).rows;
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].state, "completed");
    assert.deepEqual(receipts[0].receipt, { outcome: "failed_after_cleanup", usage: "unknown" });
    await reconcileLostBuildWorkers();
    assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int n from build_logs where level='error'")).rows[0].n, 1);
    assert.equal((await pool.query("select preview_url from projects where id='fixture'")).rows[0].preview_url, "https://previous.fixture.invalid");
    const job = (await pool.query("select checkpoint_hash from build_worker_jobs where build_id='fixture'")).rows[0];
    const checkpoint = await verifySourceCheckpoint(join(root, "checkpoints"), job.checkpoint_hash);
    assert.equal(await readFile(join(checkpoint.path, "files", "Saved.sol"), "utf8"), "source retained after yielded error");
  });

  for (const kind of ["tool", "deployment", "publication"] as const) {
    await t.test(`an uncertain ${kind} remains reserved after local failure`, async function externalUncertainty() {
      await enroll();
      const outcome = await runBuildWorkerOnce("guarded-worker", { builder() {
        return { async *run() {
          await workerOperation("uncertain-fixture", kind, async function fail() { throw new Error("Controlled failure after durable dispatch intent"); });
          yield { phase: "done", text: "Must not settle unresolved work" };
        } };
      } });
      assert.equal(outcome, "recovery_required");
      assert.equal((await pool.query("select status from builds where id='fixture'")).rows[0].status, "building");
      assert.equal((await pool.query("select state from build_worker_jobs where build_id='fixture'")).rows[0].state, "recovery_required");
      assert.deepEqual((await pool.query("select kind,state,receipt from build_worker_effects where build_id='fixture'")).rows,
        [{ kind, state: "uncertain", receipt: null }]);
      assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, 0);
    });
  }

  for (const guard of ["cleanup-failed", "fence-changed"] as const) {
    await t.test(`${guard} prevents the new failure settlement callback`, async function settlementGuard() {
      await enroll();
      let failureSettlementCalled = false;
      const outcome = await runWorkerOnce(pool, "guard-worker", {
        async run() { throw new Error("Controlled model failure"); },
        async cleanup() {
          if (guard === "cleanup-failed") throw new Error("Controlled cleanup could not confirm exit");
          await pool.query("update build_worker_jobs set fence=$1 where build_id='fixture'", [randomUUID()]);
        },
        async failAfterCleanup() { failureSettlementCalled = true; return true; },
      });
      assert.equal(outcome, "recovery_required");
      assert.equal(failureSettlementCalled, false);
      assert.equal((await pool.query("select status from builds where id='fixture'")).rows[0].status, "building");
      assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, 0);
    });
  }

  for (const change of ["rotate", "revoke"] as const) {
    await t.test(`a web-side DB ${change} aborts an in-flight worker request and denies its next request`, async function invalidate() {
      await enroll();
      let lease: CredentialLease | undefined;
      mode = "hang";
      const started = new Promise<void>((resolve) => { reached = resolve; });
      const closed = new Promise<void>((resolve) => { disconnected = resolve; });
      let response: Response | undefined;
      const running = runBuildWorkerOnce("credential-worker", { heartbeatMs: 50, leaseMs: 2000, builder(options) {
        assert.ok(options?.provider);
        const provider = options.provider;
        return { async *run() {
          await workerOperation("cli", "model", async function request() {
            lease = await leaseCredential({ ...provider, baseUrl }, "local", buildSignal());
            leases.push(lease);
            response = await call(lease);
          });
          yield { phase: "done", text: "Fixture returned" };
        } };
      } });
      try {
        await bounded(Promise.race([started, running.then(function ended(outcome) {
          throw new Error(`Worker ended before the loopback request: ${outcome}`);
        })]), "Loopback request did not start");
        // A separate connection changes durable credentials without invoking the
        // worker process's in-memory revocation listener, as the web process does.
        if (change === "rotate") await admin.query(`update ${namespace}.user_model_keys set version=2 where id='fixture-key'`);
        else await admin.query(`update ${namespace}.user_model_keys set revoked_at=clock_timestamp() where id='fixture-key'`);
        await bounded(closed, `Worker request survived credential ${change}`);
        assert.equal(await bounded(running, "Worker did not finish stopping"), "stopped");
        assert.equal(response?.status, 400);
        assert.ok(lease);
        assert.equal((await call(lease)).status, 401);
        assert.equal(requests, 1);
      } finally {
        lease?.release();
        await bounded(running, "Worker did not clean up");
      }
    });
  }
});
