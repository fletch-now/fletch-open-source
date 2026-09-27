import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { Pool } from "pg";
import type { BuildEvent } from "./types";

const ADDRESS = `0x${"ab".repeat(20)}`;
const DEPLOYED: BuildEvent = { phase: "deploying", text: "Deployment confirmed", contractAddress: ADDRESS,
  txHash: `0x${"12".repeat(32)}`, abi: [], bytecode: "0x6000", bytecodeHash: "fixture-code" };
const VERIFIED: BuildEvent = { phase: "deploying", text: "Source verified on Blockscout", contractAddress: ADDRESS.toUpperCase(), verified: true };
const FAILED: BuildEvent = { phase: "deploying", text: "Verification lookup unavailable", contractAddress: ADDRESS, verified: false, verifyError: "Controlled explorer lookup failure" };
const ADDRESS_ONLY: BuildEvent = { phase: "deploying", text: "Retained deployment", contractAddress: ADDRESS };

// Exercise the private legacy persistence function without exporting a new
// runtime API. All its SQL and table declarations are the actual runner source.
async function legacyWriter(database: typeof import("@/lib/db")): Promise<(id: string, event: BuildEvent) => Promise<void>> {
  const result = await build({
    stdin: { contents: `${await readFile("lib/build/runner.ts", "utf8")}\nexport { recordContract };`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "isolated-database", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/db$/ }, (args) => ({ path: args.path, external: true }));
      plugin.onResolve({ filter: /^server-only$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "", loader: "js" }));
    } }],
  });
  const compiled = { exports: {} as { recordContract: (id: string, event: BuildEvent) => Promise<void> } };
  const require = createRequire(`${process.cwd()}/package.json`);
  new Function("require", "module", "exports", result.outputFiles[0].text)((id: string) => id === "@/lib/db" ? database : require(id), compiled, compiled.exports);
  return compiled.exports.recordContract;
}

test("explorer receipts survive later failures in both build runners", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL, timeout: 30_000,
}, async function verification(t) {
  const fixtureUrl = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(fixtureUrl.hostname), "Only a local disposable database is allowed");
  const admin = new Pool({ connectionString: fixtureUrl.toString() });
  const namespace = `verification_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  fixtureUrl.searchParams.set("options", `-c search_path=${namespace},public`);
  const root = await mkdtemp(join(tmpdir(), "fletch-verification-"));
  const environment = ["DATABASE_URL", "MOONSHOT_API_KEY", "FORGE_WORKSPACE_ROOT", "FORGE_CHECKPOINT_ROOT"] as const;
  const previous = new Map(environment.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = fixtureUrl.toString();
  process.env.MOONSHOT_API_KEY = "unused-controlled-provider-key";
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  const database = await import("@/lib/db");
  const { pool, close } = database;
  t.after(async function cleanup() {
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
    for (const name of environment) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  for (const table of ["audit_log", "builds", "build_logs", "credit_events", "projects", "contracts", "wallet_address", "app_settings"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  const { runBuildWorkerOnce } = await import("./durable/runner");
  const { enrollWorkerBuild } = await import("./durable/ownership");
  const { requestBuildStop, failClaimedBuild } = await import("./queue");
  const recordContract = await legacyWriter(database);

  const cases = [
    { name: "confirmed proof before publication failure", events: [VERIFIED, ADDRESS_ONLY], verified: true, error: null },
    { name: "failed first verification retains its error", events: [FAILED, ADDRESS_ONLY], verified: false, error: FAILED.verifyError },
    { name: "later lookup failure retains established proof and latest error", events: [VERIFIED, FAILED, ADDRESS_ONLY], verified: true, error: FAILED.verifyError },
    { name: "another address cannot change this deployment", events: [{ ...VERIFIED, contractAddress: `0x${"cd".repeat(20)}` }, ADDRESS_ONLY], verified: false, error: null },
    { name: "Stop after verification retains proof", events: [VERIFIED, ADDRESS_ONLY], verified: true, error: null, stop: true },
  ];
  for (const mode of ["legacy", "worker"] as const) for (const fixture of cases) {
    await t.test(`${mode}: ${fixture.name}`, async function run() {
      const id = randomUUID();
      await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'fixture-owner',$1,'Fixture','https://previous.fixture.invalid')", [id]);
      await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model) values($1,'fixture-owner',$1,'Fixture','platform','platform','kimi-k3')", [id]);
      await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-1,'build_debit',$2)", [id, `build_debit:${id}`]);
      let firstVerifiedAt: string | null = null;
      async function observeProof(event: BuildEvent): Promise<void> {
        if (event.verified === true && event.contractAddress?.toLowerCase() === ADDRESS && !firstVerifiedAt) {
          const result = await pool.query("select verified, verified_at::text from contracts where build_id=$1", [id]);
          assert.equal(result.rows[0]?.verified, true, "Proof must be stored before the builder proceeds to hosting");
          firstVerifiedAt = result.rows[0].verified_at;
        }
      }
      if (mode === "legacy") {
        await pool.query("update builds set status='building' where id=$1", [id]);
        await recordContract(id, DEPLOYED);
        for (const event of fixture.events) {
          await recordContract(id, event);
          await observeProof(event);
        }
        if (fixture.stop) await requestBuildStop(id, "fixture-owner");
        await failClaimedBuild(id, "fixture-owner", fixture.stop ? "Stop requested." : "Certificate publication failed.");
      } else {
        await enrollWorkerBuild(pool, id);
        const outcome = await runBuildWorkerOnce("verification-fixture", { heartbeatMs: 20, leaseMs: 2_000, builder() {
          return { async *run() {
            yield { ...DEPLOYED };
            for (const event of fixture.events) {
              yield { ...event };
              await observeProof(event);
            }
            if (fixture.stop) await requestBuildStop(id, "fixture-owner");
            yield { phase: "error", text: "Certificate publication failed." };
          } };
        } });
        assert.equal(outcome, fixture.stop ? "stopped" : "completed");
      }
      const saved = await pool.query("select *, verified_at::text as proof_time from contracts where build_id=$1", [id]);
      assert.equal(saved.rows.length, 1);
      assert.equal(saved.rows[0].address, ADDRESS);
      assert.equal(saved.rows[0].verified, fixture.verified);
      assert.equal(saved.rows[0].verify_error, fixture.error);
      assert.equal(saved.rows[0].proof_time, firstVerifiedAt);
      assert.equal(saved.rows[0].tx_hash, DEPLOYED.txHash);
      assert.equal(saved.rows[0].bytecode, DEPLOYED.bytecode);
      const terminal = await pool.query("select status,preview_url from builds join projects on projects.id=builds.project_id where builds.id=$1", [id]);
      assert.equal(terminal.rows[0].status, "failed");
      assert.equal(terminal.rows[0].preview_url, "https://previous.fixture.invalid");
      assert.equal((await pool.query("select count(*)::int as count from credit_events where build_id=$1 and reason='refund'", [id])).rows[0].count, 1);
    });
  }
});
