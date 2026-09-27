import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { keccak256, parseTransaction, type Hex } from "viem";
import type { BuildExecution } from "./execution";

const ADDRESS = `0x${"22".repeat(20)}`;
const BLOCK_HASH = `0x${"33".repeat(32)}`;
const BLOOM = `0x${"00".repeat(256)}`;
const BLOCK = {
  number: "0x1", hash: BLOCK_HASH, parentHash: BLOCK_HASH, baseFeePerGas: "0x1", gasLimit: "0x1c9c380",
  gasUsed: "0x0", timestamp: "0x1", transactions: [], miner: ADDRESS, difficulty: "0x0", extraData: "0x",
  logsBloom: BLOOM, nonce: "0x0000000000000000", receiptsRoot: BLOCK_HASH, sha3Uncles: BLOCK_HASH,
  stateRoot: BLOCK_HASH, transactionsRoot: BLOCK_HASH, size: "0x1",
};
const CONTRACTS = [{ name: "StopApp", source: "contracts/StopApp.sol", bytecodeBytes: 5, functions: 0, events: 0, abi: [] }];

test("actual worker deployment keeps unknown sends reserved and preserves a mined receipt after Stop", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL, timeout: 15_000,
}, async function deployment(t) {
  const fixtureUrl = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(fixtureUrl.hostname), "This RPC/worker fixture accepts only a local disposable database");
  const admin = new Pool({ connectionString: fixtureUrl.toString() });
  const namespace = `worker_deploy_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  fixtureUrl.searchParams.set("options", `-c search_path=${namespace},public`);
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-worker-deploy-")));
  const environment = ["DATABASE_URL", "MOONSHOT_API_KEY", "FORGE_WORKSPACE_ROOT", "FORGE_CHECKPOINT_ROOT", "FORGE_DEPLOYER_KEY_46630", "RPC_URL_46630"] as const;
  const previous = new Map(environment.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = fixtureUrl.toString();
  process.env.MOONSHOT_API_KEY = "unused-controlled-provider-key";
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  // Public fixture private key. Every request is sent only to the loopback server below.
  process.env.FORGE_DEPLOYER_KEY_46630 = `0x${"01".padStart(64, "0")}`;
  const { db, pool, close } = await import("@/lib/db");
  const { runBuildWorkerOnce, reconcileLostBuildWorkers } = await import("./runner");
  const { enrollWorkerBuild } = await import("./ownership");
  const { currentWorkerExecution, withWorkerExecution } = await import("./execution");
  const { requestBuildStop } = await import("@/lib/build/queue");
  const { withBuildCancellation } = await import("@/lib/build/cancellation");
  const { deployToTestnet } = await import("@/lib/build/deploy");
  let scenario: "timeout" | "stop" | "receipt-crash" = "timeout";
  let currentHash: Hex = BLOCK_HASH as Hex;
  const broadcasts: Hex[] = [];
  let receiptRequests = 0;
  let stopObserved = false;
  let concurrent = false;
  let nonce = 0;
  const firstBroadcast = Promise.withResolvers<void>();
  const firstReceipt = Promise.withResolvers<void>();
  const server = createServer(async function rpc(request, response) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string; params?: unknown[] };
      let result: unknown;
      switch (message.method) {
        case "eth_getBalance": result = "0xde0b6b3a7640000"; break;
        case "eth_getTransactionCount": result = concurrent ? `0x${nonce.toString(16)}` : "0x0"; break;
        case "eth_chainId": result = "0xb626"; break;
        case "eth_getBlockByNumber": result = BLOCK; break;
        case "eth_blockNumber": result = "0x1"; break;
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas": result = "0x1"; break;
        case "eth_estimateGas": result = "0x186a0"; break;
        case "eth_sendRawTransaction": {
          const raw = message.params?.[0] as Hex;
          assert.match(raw, /^0x[0-9a-f]+$/i);
          if (concurrent && broadcasts.length === 1) {
            const previous = await pool.query("select state from build_worker_effects where build_id='parallel-a' and kind='deployment'");
            assert.equal(previous.rows[0].state, "completed", "The first durable receipt must be visible before the second send");
          }
          broadcasts.push(raw);
          if (concurrent) { nonce++; if (broadcasts.length === 1) firstBroadcast.resolve(); }
          currentHash = keccak256(raw);
          result = currentHash;
          break;
        }
        case "eth_getTransactionByHash":
          result = { hash: currentHash, blockHash: null, blockNumber: null, from: ADDRESS, to: null,
            nonce: "0x0", gas: "0x186a0", gasPrice: "0x1", value: "0x0", input: "0x6001600055", type: "0x2", transactionIndex: null };
          break;
        case "eth_getTransactionReceipt":
          receiptRequests++;
          if (concurrent && broadcasts.length === 1) await firstReceipt.promise;
          assert.equal(message.params?.[0], currentHash);
          if (scenario === "timeout") result = null;
          else {
            if (scenario === "stop") assert.equal(stopObserved, true, "The worker must observe Stop before the receipt is returned");
            result = { transactionHash: currentHash, transactionIndex: "0x0", blockHash: BLOCK_HASH, blockNumber: "0x1",
              from: ADDRESS, to: null, contractAddress: ADDRESS, cumulativeGasUsed: "0x1", gasUsed: "0x1",
              effectiveGasPrice: "0x1", logs: [], logsBloom: BLOOM, status: "0x1", type: "0x2" };
          }
          break;
        default: throw new Error(`Unexpected fixture RPC method ${message.method}`);
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    } catch (cause) {
      response.statusCode = 500;
      response.end(cause instanceof Error ? cause.message : String(cause));
    }
  });
  t.after(async function cleanup() {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
    for (const name of environment) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const table of ["audit_log", "builds", "build_logs", "credit_events", "projects", "contracts", "wallet_address", "app_settings"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  // Check transaction visibility, not timestamps from the application host and
  // database container, whose clocks can differ even on the same workstation.
  await pool.query(`create function fixture_contract_before_terminal() returns trigger language plpgsql as $$ begin
    if new.status in ('failed','succeeded') and exists (
      select 1 from build_worker_effects where build_id=new.id and kind='deployment'
        and state='completed' and receipt->'result'->>'ok'='true'
    ) and not exists (select 1 from contracts where build_id=new.id) then
      raise exception 'A confirmed deployment must be saved before terminal settlement';
    end if;
    return new;
  end $$`);
  await pool.query("create trigger fixture_contract_order before update of status on builds for each row execute function fixture_contract_before_terminal()");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.RPC_URL_46630 = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  async function enroll(id: string, projectId = id): Promise<void> {
    await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'fixture-owner',$1,'Fixture','https://previous.fixture.invalid') on conflict do nothing", [projectId]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model) values($1,'fixture-owner',$2,'Fixture','platform','platform','kimi-k3')", [id, projectId]);
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-1,'build_debit',$2)", [id, `build_debit:${id}`]);
    await enrollWorkerBuild(pool, id);
    const workspace = join(root, "workspaces", projectId);
    await mkdir(join(workspace, "contracts"), { recursive: true });
    await mkdir(join(workspace, "out", "StopApp.sol"), { recursive: true });
    await writeFile(join(workspace, "contracts", "StopApp.sol"), "pragma solidity ^0.8.28; contract StopApp {}");
    await writeFile(join(workspace, "out", "StopApp.sol", "StopApp.json"), JSON.stringify({ abi: [], bytecode: { object: "0x6001600055" },
      metadata: { settings: { compilationTarget: { "contracts/StopApp.sol": "StopApp" } } } }));
  }

  const cases = [
    { mode: "timeout", name: "receipt timeout retains uncertain deployment, project and debit without rebroadcast" },
    { mode: "stop", name: "Stop preserves the confirmed receipt before stopped settlement and never replays the send" },
    { mode: "receipt-crash", name: "recovery preserves a completed deployment receipt after interruption before the address event" },
  ] as const;
  for (const { mode, name } of cases) {
    await t.test(name, async function run(caseTest) {
      process.env.FORGE_DEPLOYER_KEY_46630 = `0x${String(cases.findIndex((item) => item.mode === mode) + 1).padStart(64, "0")}`;
      scenario = mode;
      broadcasts.length = 0;
      receiptRequests = 0;
      stopObserved = false;
      const id = `deploy-${mode}`;
      await enroll(id);
      let execution: BuildExecution | undefined;
      // Accelerate only the pinned receipt deadline; actual viem signing, HTTP,
      // transaction transport and worker heartbeats remain unchanged.
      const nativeTimeout = globalThis.setTimeout;
      const deadline = caseTest.mock.method(globalThis, "setTimeout", function timeout(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) {
        return nativeTimeout(callback, ms === 90_000 ? 200 : ms, ...args);
      });
      let outcome: string;
      try {
        outcome = await runBuildWorkerOnce("deployment-fixture", { heartbeatMs: 20, leaseMs: 2000, builder(options) {
          return { async *run(input) {
            execution = currentWorkerExecution();
            assert.ok(execution);
            const result = await deployToTestnet(join(root, "workspaces", input.slug), CONTRACTS, null, null, async function broadcast(hash) {
              await options?.onBroadcast?.(hash);
              if (mode === "stop") {
                await requestBuildStop(id, "fixture-owner", db);
                const signal = execution!.signal;
                if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
                stopObserved = true;
              }
            });
            if (mode === "receipt-crash") {
              assert.ok(result.ok);
              await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [id]);
              throw new Error("Controlled worker interruption after durable receipt, before address event");
            }
            if (result.ok) yield { phase: "deploying", text: "Controlled mined deployment", contractAddress: result.address,
              txHash: result.txHash ?? undefined, bytecodeHash: result.bytecodeHash, bytecode: result.bytecode, abi: [...result.abi] };
            yield { phase: result.ok ? "done" : "error", text: result.ok ? "Controlled completion" : "Controlled deployment failure" };
          } };
        } });
      } finally { deadline.mock.restore(); }
      assert.equal(broadcasts.length, 1, JSON.stringify({ outcome, build: (await pool.query("select status,error from builds where id=$1", [id])).rows, job: (await pool.query("select state,recovery_reason from build_worker_jobs where build_id=$1", [id])).rows }));
      assert.ok(receiptRequests > 0, "The real transport must request a transaction receipt");
      const prepared = (await pool.query("select detail from build_worker_events where build_id=$1 and kind='transaction_prepared'", [id])).rows;
      assert.equal(prepared.length, 1);
      assert.equal(prepared[0].detail.signedTransaction, broadcasts[0]);
      assert.equal(prepared[0].detail.txHash, keccak256(broadcasts[0]));
      const effect = (await pool.query("select state,receipt from build_worker_effects where build_id=$1 and kind='deployment'", [id])).rows[0];
      const build = (await pool.query("select status,finished_at from builds where id=$1", [id])).rows[0];
      if (mode === "timeout") {
        assert.equal(outcome, "recovery_required");
        assert.equal(effect.state, "uncertain");
        assert.equal(effect.receipt, null);
        assert.equal(build.status, "building");
        assert.equal(build.finished_at, null);
        assert.equal((await pool.query("select count(*)::int as n from contracts where build_id=$1", [id])).rows[0].n, 0);
        assert.equal((await pool.query("select sum(delta)::int as total from credit_events where build_id=$1", [id])).rows[0].total, -1);
        await enroll(`${id}-next`, id);
        assert.equal(await runBuildWorkerOnce("successor", { builder() { throw new Error("A held project cannot dispatch again"); } }), "idle");
        assert.equal(await requestBuildStop(id, "fixture-owner", db), true);
        await reconcileLostBuildWorkers();
        assert.equal((await pool.query("select status from builds where id=$1", [id])).rows[0].status, "building", "Stop cannot discard an unresolved chain transaction");
        const other = `${id}-other-project`;
        await enroll(other);
        await runBuildWorkerOnce("same-sender-other-project", { builder() { return { async *run(input) {
          const blocked = await deployToTestnet(join(root, "workspaces", input.slug), CONTRACTS, null, null);
          assert.equal(blocked.ok, false);
          assert.ok("error" in blocked && blocked.error.includes("earlier deployment"));
          yield { phase: "error", text: "Sender outcome needs reconciliation" };
        } }; } });
        assert.equal(broadcasts.length, 1, "Another project must not reuse a sender with an unresolved prepared transaction");
        assert.equal((await pool.query("select sum(delta)::int as total from credit_events where build_id=$1", [other])).rows[0].total, 0);
      } else {
        if (mode === "receipt-crash") {
          assert.equal(outcome, "recovery_required");
          assert.equal(build.status, "building");
          assert.equal(await requestBuildStop(id, "fixture-owner", db), true);
          await reconcileLostBuildWorkers();
          Object.assign(build, (await pool.query("select status,finished_at from builds where id=$1", [id])).rows[0]);
        } else assert.equal(outcome, "stopped");
        assert.equal(effect.state, "completed");
        assert.equal(effect.receipt.result.txHash, currentHash);
        assert.equal(effect.receipt.result.address, ADDRESS);
        assert.equal(build.status, "failed");
        assert.ok(build.finished_at);
        const contract = (await pool.query("select address,tx_hash,confirmed_at from contracts where build_id=$1", [id])).rows[0];
        assert.equal(contract.address, ADDRESS);
        assert.equal(contract.tx_hash, currentHash);
        assert.ok(contract.confirmed_at, "The confirmed contract is saved; the fixture trigger enforces visibility before terminal settlement");
        assert.equal((await pool.query("select sum(delta)::int as total from credit_events where build_id=$1", [id])).rows[0].total, 0);
        assert.equal((await pool.query("select count(*)::int as n from build_logs where build_id=$1 and level='done'", [id])).rows[0].n, 0);
      }
      assert.equal((await pool.query("select preview_url from projects where id=$1", [id])).rows[0].preview_url, "https://previous.fixture.invalid");
      assert.ok(execution);
      await assert.rejects(withBuildCancellation(execution.signal, () => withWorkerExecution(execution!, () => deployToTestnet(execution!.workspace, CONTRACTS, null, null))), /ownership|stopped|Stop/i);
      assert.equal(broadcasts.length, 1, "An attempted stale-owner replay must never broadcast a second transaction");
    });
  }
  await t.test("two actual worker deployments serialize one sender through durable completion", async function parallel() {
    await pool.query("truncate builds,build_worker_jobs cascade");
    process.env.FORGE_DEPLOYER_KEY_46630 = `0x${"04".padStart(64, "0")}`;
    concurrent = true;
    scenario = "receipt-crash";
    broadcasts.length = 0;
    nonce = 0;
    await enroll("parallel-a"); await enroll("parallel-b");
    const options = { heartbeatMs: 20, leaseMs: 2000, builder() {
      return { async *run(input: { slug: string }) {
        const deployed = await deployToTestnet(join(root, "workspaces", input.slug), CONTRACTS, null, null);
        assert.ok(deployed.ok);
        yield { phase: "deploying" as const, text: "Controlled deployment", contractAddress: deployed.address,
          txHash: deployed.txHash ?? undefined, bytecodeHash: deployed.bytecodeHash, bytecode: deployed.bytecode, abi: [...deployed.abi] };
        yield { phase: "done" as const, text: "Controlled completion" };
      } };
    } };
    const first = runBuildWorkerOnce("parallel-first", options);
    await firstBroadcast.promise;
    const second = runBuildWorkerOnce("parallel-second", options);
    try {
      await delay(150);
      assert.equal((await pool.query("select count(*)::int as n from build_worker_jobs where state='running'")).rows[0].n, 2);
      assert.equal(broadcasts.length, 1, "The second sender waits while the first receipt is unconfirmed");
    } finally { firstReceipt.resolve(); }
    assert.deepEqual(await Promise.all([first, second]), ["completed", "completed"]);
    assert.deepEqual(broadcasts.map((raw) => parseTransaction(raw).nonce), [0, 1]);
    assert.equal((await pool.query("select count(*)::int as n from build_worker_effects where kind='deployment' and state='completed'")).rows[0].n, 2);
  });

});
