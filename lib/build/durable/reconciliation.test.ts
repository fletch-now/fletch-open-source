import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BYTECODE = "0x6001600055" as Hex;
const ADDRESS = `0x${"22".repeat(20)}`;
const BLOCK_HASH = `0x${"33".repeat(32)}`;
const BLOOM = `0x${"00".repeat(256)}`;
const EFFECT_KEY = "1:deployment";
const CHECKPOINT = "a".repeat(64);

test("operator reconciliation verifies exact external evidence before resolving a paused build", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL, timeout: 15_000,
}, async function reconciliation(t) {
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Use only a local disposable fixture database");
  const admin = new Pool({ connectionString: url.toString() });
  const namespace = `reconcile_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  const root = await mkdtemp(join(tmpdir(), "fletch-reconciliation-"));
  const keys = ["DATABASE_URL", "FORGE_SITES_ROOT", "RPC_URL_46630"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.DATABASE_URL = url.toString();
  process.env.FORGE_SITES_ROOT = join(root, "sites");
  const { pool, close } = await import("@/lib/db");
  const { reconcileWorkerEffect } = await import("./reconciliation");
  const { reconcileLostBuildWorkers } = await import("./runner");
  const { appendWorkerEvent, beginWorkerEffect, claimWorkerBuild, enrollWorkerBuild, recordWorkerCheckpoint, recoverExpiredWorkers, workerTransaction } = await import("./ownership");
  const { STOP_REQUESTED } = await import("@/lib/build/cancellation");
  // Public test key; signing is local and this fixture never broadcasts.
  const account = privateKeyToAccount(`0x${"01".padStart(64, "0")}`);
  const raw = await account.signTransaction({ chainId: 46630, type: "eip1559", nonce: 0,
    gas: BigInt(100_000), maxFeePerGas: BigInt(2), maxPriorityFeePerGas: BigInt(1), data: BYTECODE });
  const txHash = keccak256(raw);
  let receiptMode: "success" | "revert" | "missing" | "wrong-chain" | "wrong-sender" | "reorg" = "success";
  let beforeReceipt: (() => Promise<void>) | undefined;
  const methods: string[] = [];
  const server = createServer(async function rpc(request, response) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string; params: unknown[] };
      methods.push(message.method);
      let result: unknown;
      if (message.method === "eth_chainId") result = receiptMode === "wrong-chain" ? "0xb627" : "0xb626";
      else if (message.method === "eth_getTransactionReceipt") {
        assert.equal(message.params[0], txHash);
        await beforeReceipt?.();
        result = receiptMode === "missing" ? null : {
          transactionHash: txHash, transactionIndex: "0x0", blockHash: BLOCK_HASH, blockNumber: "0x1",
          from: receiptMode === "wrong-sender" ? ADDRESS : account.address, to: null,
          contractAddress: receiptMode === "revert" ? null : ADDRESS, cumulativeGasUsed: "0x1", gasUsed: "0x1",
          effectiveGasPrice: "0x1", logs: [], logsBloom: BLOOM, status: receiptMode === "revert" ? "0x0" : "0x1", type: "0x2",
        };
      } else if (message.method === "eth_getBlockByNumber") result = {
        number: "0x1", hash: receiptMode === "reorg" ? `0x${"44".repeat(32)}` : BLOCK_HASH,
        parentHash: BLOCK_HASH, baseFeePerGas: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", timestamp: "0x1",
        transactions: [], miner: account.address, difficulty: "0x0", extraData: "0x", logsBloom: BLOOM,
        nonce: "0x0000000000000000", receiptsRoot: BLOCK_HASH, sha3Uncles: BLOCK_HASH, stateRoot: BLOCK_HASH,
        transactionsRoot: BLOCK_HASH, size: "0x1",
      };
      else throw new Error(`Unexpected RPC method ${message.method}`);
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
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const table of ["builds", "build_logs", "credit_events", "projects", "contracts"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.RPC_URL_46630 = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  async function paused(id: string, kind: "deployment" | "publication" = "deployment"): Promise<void> {
    await pool.query("truncate build_worker_events,build_worker_effects,build_worker_jobs,build_logs,contracts,credit_events,builds,projects");
    methods.length = 0;
    beforeReceipt = undefined;
    receiptMode = "success";
    await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'fixture-owner',$1,'Fixture','https://previous.fixture.invalid')", [id]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model) values($1,'fixture-owner',$1,'Fixture','platform','platform','kimi-k3')", [id]);
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-1,'build_debit',$2)", [id, `build_debit:${id}`]);
    await enrollWorkerBuild(pool, id);
    const claim = await claimWorkerBuild(pool, "checked-worker");
    assert.ok(claim);
    await recordWorkerCheckpoint(pool, claim, CHECKPOINT);
    await beginWorkerEffect(pool, claim, EFFECT_KEY, kind);
    const detail = kind === "deployment" ? {
      effectKey: EFFECT_KEY, chainId: 46630, txHash, signedTransaction: raw, sender: account.address,
      bytecodeHash: keccak256(BYTECODE), deployment: { abi: [], bytecode: BYTECODE, contractName: "StopApp",
        contractPath: "contracts/StopApp.sol:StopApp", bytecodeHash: keccak256(BYTECODE), constructorArgs: "0x", owner: null },
    } : { effectKey: EFFECT_KEY, slug: id, buildId: id, previousRelease: "previous" };
    await workerTransaction(pool, (client) => appendWorkerEvent(client, id, kind === "deployment" ? "transaction_prepared" : "publication_prepared", detail));
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [id]);
    await recoverExpiredWorkers(pool);
  }
  async function held(id: string): Promise<void> {
    const row = (await pool.query("select j.state,b.status,e.state as effect from build_worker_jobs j join builds b on b.id=j.build_id join build_worker_effects e on e.build_id=j.build_id where j.build_id=$1", [id])).rows[0];
    assert.deepEqual(row, { state: "recovery_required", status: "building", effect: "uncertain" });
    assert.equal((await pool.query("select sum(delta)::int as total from credit_events where build_id=$1", [id])).rows[0].total, -1);
    assert.equal((await pool.query("select count(*)::int as n from build_worker_events where build_id=$1 and kind='operator_reconciled'", [id])).rows[0].n, 0);
  }
  const stopped = async function stopped(): Promise<void> {};

  await t.test("default inspection is read-only and exposes no signed transaction", async function inspect() {
    const id = "inspect-deploy";
    await paused(id);
    const report = await reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY,
      async verifyWorkerStopped() { throw new Error("Read-only inspection must not require stopping the worker"); } });
    assert.equal(report.outcome, "ready");
    assert.equal(report.txHash, txHash);
    assert.ok(!JSON.stringify(report).includes(raw));
    assert.ok(!JSON.stringify(report).includes("signedTransaction"));
    await held(id);
  });

  for (const mode of ["success", "revert"] as const) {
    await t.test(`canonical ${mode} receipt resolves once; Stop settles without rebroadcast`, async function apply() {
      const id = `apply-${mode}`;
      await paused(id);
      receiptMode = mode;
      let stoppedChecks = 0;
      const report = await reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true,
        async verifyWorkerStopped() { stoppedChecks++; } });
      assert.equal(report.outcome, "applied");
      assert.equal(stoppedChecks, 2);
      const effect = (await pool.query("select state,receipt from build_worker_effects where build_id=$1", [id])).rows[0];
      assert.equal(effect.state, "completed");
      assert.equal(effect.receipt.result.ok, mode === "success");
      if (mode === "success") assert.equal(effect.receipt.result.address, ADDRESS);
      else assert.match(effect.receipt.result.error, /reverted/);
      await pool.query("update builds set error=$2 where id=$1", [id, STOP_REQUESTED]);
      await reconcileLostBuildWorkers();
      await reconcileLostBuildWorkers();
      assert.equal((await pool.query("select state from build_worker_jobs where build_id=$1", [id])).rows[0].state, "stopped");
      assert.equal((await pool.query("select sum(delta)::int as total from credit_events where build_id=$1", [id])).rows[0].total, 0);
      const contracts = (await pool.query("select address,tx_hash from contracts where build_id=$1", [id])).rows;
      assert.deepEqual(contracts, mode === "success" ? [{ address: ADDRESS, tx_hash: txHash }] : []);
      assert.equal((await pool.query("select preview_url from projects where id=$1", [id])).rows[0].preview_url, "https://previous.fixture.invalid");
      await assert.rejects(reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true, verifyWorkerStopped: stopped }), /No paused uncertain/);
      assert.ok(!methods.includes("eth_sendRawTransaction"));
    });
  }

  await t.test("missing receipt keeps the debit and project reserved", async function absent() {
    const id = "missing-receipt";
    await paused(id);
    receiptMode = "missing";
    const report = await reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true, verifyWorkerStopped: stopped });
    assert.equal(report.outcome, "held");
    await held(id);
    await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model) values('next-build','fixture-owner',$1,'Fixture','platform','platform','kimi-k3')", [id]);
    await enrollWorkerBuild(pool, "next-build");
    assert.equal(await claimWorkerBuild(pool, "successor"), null);
  });

  for (const mode of ["wrong-chain", "wrong-sender", "reorg"] as const) {
    await t.test(`reject ${mode} evidence without completing the effect`, async function invalid() {
      const id = `reject-${mode}`;
      await paused(id);
      receiptMode = mode;
      await assert.rejects(reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true, verifyWorkerStopped: stopped }), /wrong chain|does not match|no longer canonical/);
      await held(id);
    });
  }

  await t.test("a fence changed during the RPC read cannot apply the old receipt", async function fenced() {
    const id = "fence-changed";
    await paused(id);
    beforeReceipt = async function replaceFence() { await pool.query("update build_worker_jobs set fence=$2 where build_id=$1", [id, randomUUID()]); };
    await assert.rejects(reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true, verifyWorkerStopped: stopped }), /attempt changed/);
    await held(id);
  });

  await t.test("worker cleanup verification must succeed before mutation", async function cleanupFailure() {
    const id = "cleanup-failed";
    await paused(id);
    await assert.rejects(reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true,
      async verifyWorkerStopped() { throw new Error("Controlled worker is still running"); } }), /still running/);
    await held(id);
  });

  for (const kind of ["deployment", "publication"] as const) {
    await t.test(`absent ${kind} preparation resolves only after verified owner cleanup`, async function noPreparation() {
      const id = `unprepared-${kind}`;
      await paused(id, kind);
      await pool.query("delete from build_worker_events where build_id=$1 and kind in ('transaction_prepared','publication_prepared')", [id]);
      let stoppedChecks = 0;
      const options = { buildId: id, effectKey: EFFECT_KEY, async verifyWorkerStopped() { stoppedChecks++; } };
      assert.equal((await reconcileWorkerEffect(pool, options)).outcome, "ready");
      assert.equal(stoppedChecks, 0);
      await held(id);
      assert.equal((await reconcileWorkerEffect(pool, { ...options, apply: true })).outcome, "applied");
      assert.equal(stoppedChecks, 2);
      const effect = (await pool.query("select state,receipt from build_worker_effects where build_id=$1", [id])).rows[0];
      assert.equal(effect.state, "completed");
      assert.equal(effect.receipt.outcome, "not_dispatched");
      assert.deepEqual(methods, [], "No preparation means no external lookup or dispatch is necessary");
    });
  }

  await t.test("preparation appearing during cleanup cannot be mistaken for no dispatch", async function preparationRace() {
    const id = "late-preparation";
    await paused(id);
    const prepared = (await pool.query("delete from build_worker_events where build_id=$1 and kind='transaction_prepared' returning detail", [id])).rows[0].detail;
    let firstCheck = true;
    await assert.rejects(reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true,
      async verifyWorkerStopped() {
        if (!firstCheck) return;
        firstCheck = false;
        await workerTransaction(pool, (client) => appendWorkerEvent(client, id, "transaction_prepared", prepared));
      } }), /Preparation appeared/);
    await held(id);
  });

  await t.test("contract metadata must match the signed transaction's deployment payload", async function metadataMismatch() {
    const id = "wrong-deployment-data";
    await paused(id);
    const prepared = (await pool.query("select detail from build_worker_events where build_id=$1 and kind='transaction_prepared'", [id])).rows[0].detail;
    prepared.deployment.bytecode = "0x6002600055";
    prepared.bytecodeHash = keccak256(prepared.deployment.bytecode);
    prepared.deployment.bytecodeHash = prepared.bytecodeHash;
    await pool.query("update build_worker_events set detail=$2 where build_id=$1 and kind='transaction_prepared'", [id, prepared]);
    await assert.rejects(reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true, verifyWorkerStopped: stopped }), /does not match the signed/);
    await held(id);
  });

  for (const mode of ["absent", "appeared", "prior"] as const) {
    await t.test(`publication directory missing after preparation: ${mode}`, async function missingPublication() {
      const id = `missing-site-${mode}`;
      await paused(id, "publication");
      if (mode !== "prior") {
        await pool.query("update build_worker_events set detail=jsonb_set(detail,'{previousRelease}','null'::jsonb) where build_id=$1 and kind='publication_prepared'", [id]);
        await pool.query("update projects set preview_url=null where id=$1", [id]);
      }
      const site = join(root, "sites", id);
      let stoppedChecks = 0;
      const options = { buildId: id, effectKey: EFFECT_KEY, async verifyWorkerStopped() {
        stoppedChecks++;
        // The second check runs inside the fenced transaction. A directory that
        // appears here invalidates the earlier absence observation.
        if (mode === "appeared" && stoppedChecks === 2) await mkdir(site, { recursive: true });
      } };
      const inspect = await reconcileWorkerEffect(pool, options);
      assert.equal(inspect.outcome, mode === "prior" ? "held" : "ready");
      assert.equal(stoppedChecks, 0);
      await assert.rejects(lstat(site), { code: "ENOENT" });
      await held(id);
      if (mode === "appeared") {
        await assert.rejects(reconcileWorkerEffect(pool, { ...options, apply: true }), /changed|appeared/i);
        assert.equal(stoppedChecks, 2);
        assert.ok((await lstat(site)).isDirectory(), "The newly observed directory must remain untouched");
        await held(id);
      } else {
        const applied = await reconcileWorkerEffect(pool, { ...options, apply: true });
        assert.equal(applied.outcome, mode === "prior" ? "held" : "applied");
        await assert.rejects(lstat(site), { code: "ENOENT" });
        if (mode === "prior") {
          assert.equal(stoppedChecks, 0);
          await held(id);
        } else {
          assert.equal(stoppedChecks, 2);
          const effect = (await pool.query("select state,receipt from build_worker_effects where build_id=$1", [id])).rows[0];
          assert.equal(effect.state, "completed");
          assert.equal(effect.receipt.previousRelease, null);
        }
      }
      assert.deepEqual(methods, [], "Missing publication directories need no network calls");
    });
  }

  for (const wrong of [true, false]) {
    await t.test(wrong ? "an unrelated publication remains untouched and held" : "the exact provisional publication restores its previous release before resolving", async function publication() {
      const id = wrong ? "wrong-release" : "restore-release";
      await paused(id, "publication");
      const site = join(root, "sites", id);
      for (const release of ["previous", id, "unrelated"]) {
        await mkdir(join(site, release), { recursive: true });
        await writeFile(join(site, release, "index.html"), release);
      }
      await symlink(wrong ? "unrelated" : id, join(site, "current"));
      const inspect = await reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, verifyWorkerStopped: stopped });
      assert.equal(inspect.outcome, wrong ? "held" : "ready");
      assert.equal(await readlink(join(site, "current")), wrong ? "unrelated" : id);
      const report = await reconcileWorkerEffect(pool, { buildId: id, effectKey: EFFECT_KEY, apply: true, verifyWorkerStopped: stopped });
      assert.equal(report.outcome, wrong ? "held" : "applied");
      assert.equal(await readlink(join(site, "current")), wrong ? "unrelated" : "previous");
      assert.equal(await readFile(join(site, "previous", "index.html"), "utf8"), "previous");
      assert.equal(await readFile(join(site, id, "index.html"), "utf8"), id);
      if (wrong) await held(id);
      else assert.equal((await pool.query("select state from build_worker_effects where build_id=$1", [id])).rows[0].state, "completed");
      assert.deepEqual(methods, [], "Publication reconciliation must not contact a chain or rebroadcast");
    });
  }
});
