import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("concurrent resumes cannot exceed the account or new-pool caps", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function capacity() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, watchers } = await import("@/lib/db/schema");
  const { setWatcherEnabled, updateWatcher } = await import("@/lib/watch/create");
  const owner = randomUUID();
  const poolsOwner = randomUUID();
  const ids = Array.from({ length: 7 }, () => randomUUID());
  const poolIds = [randomUUID(), randomUUID()];
  try {
    await db.insert(user).values([{ id: owner }, { id: poolsOwner }]);
    const base = { name: "Capacity fixture", chainId: 777338, address: `0x${"7".repeat(40)}`, threshold: "1", enabled: false };
    await db.insert(watchers).values([
      ...ids.map((id) => ({ ...base, id, userId: owner, kind: "large_transfer" as const })),
      ...poolIds.map((id) => ({ ...base, id, userId: poolsOwner, kind: "new_pool" as const })),
    ]);
    const resumed = await Promise.allSettled(ids.map((id) => setWatcherEnabled(owner, id, true)));
    assert.equal(resumed.filter((result) => result.status === "fulfilled").length, 5);
    const paused = (await db.select().from(watchers).where(eq(watchers.userId, owner))).find(function disabled(row) { return !row.enabled; });
    assert.ok(paused);
    await db.update(watchers).set({ delivery: "webhook", webhookId: null, lastCheckedBlock: BigInt(123) }).where(eq(watchers.id, paused.id));
    await assert.rejects(updateWatcher(owner, paused.id, { webhookId: null, enabled: true }), { name: "WatchLimitError" });
    const [unchanged] = await db.select().from(watchers).where(eq(watchers.id, paused.id));
    assert.equal(unchanged.delivery, "webhook", "A failed resume rolls the channel change back");
    assert.equal(unchanged.enabled, false);
    assert.equal(unchanged.lastCheckedBlock, BigInt(123));
    await assert.rejects(updateWatcher(poolsOwner, paused.id, { enabled: true }), { name: "WatchNotFoundError" });
    const pools = await Promise.allSettled(poolIds.map((id) => setWatcherEnabled(poolsOwner, id, true)));
    assert.equal(pools.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(pools.filter((result) => result.status === "rejected")[0].reason.name, "WatchLimitError");
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(user).where(eq(user.id, poolsOwner));
    await close();
  }
});
