import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { POOL_STATE_FRESH_MS } from "./dex-state-freshness";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("state scheduling reserves recurring measured pools alongside a large unread backlog", async function () {
  const { allocatePoolStateReads, STATE_READ_BATCH } = await import("./dex-state-schedule");
  const preferred = Array.from({ length: 900 }, (_, index) => ({ id: `measured-${index}` }));
  const oldest = Array.from({ length: 100_000 }, (_, index) => ({ id: `unread-${index}` }));
  const selected = allocatePoolStateReads(preferred, oldest, STATE_READ_BATCH);
  assert.equal(selected.length, STATE_READ_BATCH);
  assert.equal(selected.filter((row) => row.id.startsWith("measured")).length, 750);
  assert.equal(selected.filter((row) => row.id.startsWith("unread")).length, 250);
  assert.deepEqual(selected.slice(0, 4).map((row) => row.id), ["measured-0", "measured-1", "measured-2", "unread-0"]);
  assert.equal(new Set(selected.map((row) => row.id)).size, selected.length);
  assert.equal(allocatePoolStateReads(preferred, preferred, 1000).length, 900, "overlapping lanes cannot add repeated RPC reads");
});

test("state due queries enforce cadence, canonical provenance and the existing total call cap", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function () {
  const { db, close } = await import("@/lib/db");
  const { dexPools } = await import("@/lib/db/schema");
  const { duePoolStateReads, STATE_READ_BATCH } = await import("./dex-state-schedule");
  const chainId = 777357;
  const now = new Date("2026-09-08T12:00:00Z");
  const day = 86_400_000;
  const before = (ms: number) => new Date(now.getTime() - ms);
  const base = { chainId, currency0: "0x0000000000000000000000000000000000000001", currency1: "0x0000000000000000000000000000000000000002", fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000", createdBlock: BigInt(1), firstSeenAt: before(40 * day) };
  const unread = Array.from({ length: 1100 }, (_, index) => ({ ...base, id: `${chainId}:unread-${String(index).padStart(4, "0")}` }));
  const fixtures = [
    { ...base, id: `${chainId}:visible`, depthUsd: "1000", stateCheckedAt: before(POOL_STATE_FRESH_MS) },
    { ...base, id: `${chainId}:trading`, depthUsd: "1", stateCheckedAt: before(POOL_STATE_FRESH_MS), lastSwapAt: before(60_000) },
    { ...base, id: `${chainId}:visible-fresh`, depthUsd: "1000", stateCheckedAt: before(POOL_STATE_FRESH_MS - 1) },
    { ...base, id: `${chainId}:quiet-fresh`, tier: "quiet", stateCheckedAt: before(day - 1) },
    { ...base, id: `${chainId}:quiet-due`, tier: "quiet", stateCheckedAt: before(day) },
    { ...base, id: `${chainId}:dormant-fresh`, tier: "dormant", stateCheckedAt: before(7 * day - 1) },
    { ...base, id: `${chainId}:dormant-due`, tier: "dormant", stateCheckedAt: before(7 * day) },
    { ...base, id: `${chainId}:orphan`, canonical: false, depthUsd: "1000", stateCheckedAt: before(day) },
  ];
  try {
    await db.insert(dexPools).values([...unread, ...fixtures]);
    const first = await duePoolStateReads(chainId, now, 4);
    assert.equal(first.length, 4);
    assert.equal(first[0].id, `${chainId}:visible`, "deepest measured active pool wins before shallow activity");
    assert.equal(first.slice(0, 2).every((row) => ["visible", "trading"].some((suffix) => row.id.endsWith(`:${suffix}`))), true);
    assert.equal(first.filter((row) => row.stateCheckedAt === null).length, 2, "unused priority capacity serves the oldest backlog");
    await db.update(dexPools).set({ stateCheckedAt: now }).where(inArray(dexPools.id, first.map((row) => row.id)));
    const next = await duePoolStateReads(chainId, now, 4);
    assert.equal(next.every((row) => !first.some((old) => old.id === row.id)), true, "restart must not repeat freshly checked pools");
    const recurring = await duePoolStateReads(chainId, new Date(now.getTime() + POOL_STATE_FRESH_MS), 4);
    assert.equal(recurring.some((row) => row.id === `${chainId}:visible`), true, "measured pools recur even while thousands remain unread");
    const capped = await duePoolStateReads(chainId, now, 10_000);
    assert.equal(capped.length, STATE_READ_BATCH, "selection cannot exceed the existing 1000-pool/2000 state-method cap");
    await db.delete(dexPools).where(inArray(dexPools.id, unread.map((row) => row.id)));
    const remaining = new Set((await duePoolStateReads(chainId, now)).map((row) => row.id));
    assert.deepEqual(remaining, new Set([`${chainId}:quiet-due`]));
    const [orphan] = await db.select().from(dexPools).where(eq(dexPools.id, `${chainId}:orphan`));
    assert.equal(orphan.canonical, false);
    assert.equal(orphan.firstSeenAt.toISOString(), base.firstSeenAt.toISOString());
  } finally {
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await close();
  }
});
