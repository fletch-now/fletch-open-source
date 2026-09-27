import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("control reads share a queue round, preserve confirmed checkpoint proof, and retain failed state observations", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function () {
  const { db, close } = await import("@/lib/db");
  const { syncCheckpoints, syncCheckpointHistory, registryControlState, registryControlEvents } = await import("@/lib/db/schema");
  const { scanControlPlane } = await import("./control-plane");
  const chainId = 777355;
  const checkpointName = `control-plane:${chainId}`;
  const oldHash = `0x${"a".repeat(64)}`;
  const headHash = `0x${"b".repeat(64)}`;
  const implementation = `0x${"c".repeat(40)}`;
  const entered = new Set<string>();
  let release!: () => void;
  let fail!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
  const timeout = setTimeout(() => fail(new Error("independent RPC reads were serialized")), 1000);
  function enter(phase: string): void {
    entered.add(phase);
    if (entered.size === 3) release();
  }
  let stateFailed = false;
  const headers: bigint[] = [];
  const client = {
    getBlockNumber: async function () { enter("head"); await ready; return BigInt(20); },
    getBlock: async function ({ blockNumber }: { blockNumber: bigint }) {
      headers.push(blockNumber);
      if (blockNumber === BigInt(10)) { enter("checkpoint"); await ready; }
      return { number: blockNumber, hash: blockNumber === BigInt(10) ? oldHash : headHash };
    },
    multicall: async function () {
      enter("state"); await ready;
      if (stateFailed) return [{ status: "failure" }, { status: "failure" }];
      return [{ status: "success", result: implementation }, { status: "success", result: false }];
    },
  } as unknown as PublicClient;
  try {
    await db.insert(syncCheckpoints).values({ name: checkpointName, chainId, blockNumber: BigInt(10), blockHash: oldHash });
    let scanFinishedAt = 0;
    const result = await scanControlPlane(chainId, { client, scan: async function scan(params) {
      assert.equal(params.range.fromBlock, BigInt(11));
      assert.equal(params.range.toBlock, BigInt(18));
      await new Promise((resolve) => setTimeout(resolve, 20));
      scanFinishedAt = Date.now();
      return [];
    } });
    const [point] = await db.select().from(syncCheckpoints).where(eq(syncCheckpoints.name, checkpointName));
    assert.equal(point.blockNumber, BigInt(18));
    assert.equal(point.blockHash, headHash);
    assert.deepEqual(headers, [BigInt(10), BigInt(18)], "parallelism must not add provider requests");
    const [state] = await db.select().from(registryControlState).where(eq(registryControlState.chainId, chainId));
    assert.equal(state.implementation, implementation);
    assert.equal(state.paused, false);
    assert.equal(state.checkedAt.toISOString(), result.detail?.stateObservedAt);
    assert.ok(scanFinishedAt > 0 && state.checkedAt.getTime() < scanFinishedAt, "a later scan completion must not refresh an earlier state observation");
    stateFailed = true;
    await assert.rejects(scanControlPlane(chainId, { client, scan: async () => [] }), /previous observation retained/);
    const [preserved] = await db.select().from(registryControlState).where(eq(registryControlState.chainId, chainId));
    assert.equal(preserved.checkedAt.toISOString(), state.checkedAt.toISOString());
    assert.equal(preserved.implementation, implementation);
    assert.equal(preserved.paused, false);
  } finally {
    clearTimeout(timeout);
    await db.delete(registryControlEvents).where(eq(registryControlEvents.chainId, chainId));
    await db.delete(registryControlState).where(eq(registryControlState.chainId, chainId));
    await db.delete(syncCheckpointHistory).where(eq(syncCheckpointHistory.name, checkpointName));
    await db.delete(syncCheckpoints).where(eq(syncCheckpoints.name, checkpointName));
    await close();
  }
});
