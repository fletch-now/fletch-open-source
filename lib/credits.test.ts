import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

// Opt in with a disposable database whose schema has been applied. Ordinary
// unit test runs never connect to the application's configured database.
test("refunds require an owned debit and remain idempotent", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function refunds(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, creditEvents } = await import("@/lib/db/schema");
  const { refundBuild, getBalance } = await import("@/lib/credits");
  const owner = randomUUID();
  const other = randomUUID();
  const chargedBuild = randomUUID();
  const freeBuild = randomUUID();

  try {
    await db.insert(user).values([{ id: owner }, { id: other }]);
    await db.insert(creditEvents).values({
      id: randomUUID(), userId: owner, delta: -1, reason: "build_debit",
      buildId: chargedBuild, idempotencyKey: `build_debit:${chargedBuild}`,
    });

    await t.test("a failed BYOK build grants no credit", async function byok() {
      await refundBuild(owner, freeBuild);
      assert.equal(await getBalance(owner), -1);
    });
    await t.test("another account cannot receive the refund", async function ownership() {
      await refundBuild(other, chargedBuild);
      assert.equal(await getBalance(other), 0);
    });
    await t.test("concurrent refunds restore exactly the debit", async function concurrent() {
      await Promise.all(Array.from({ length: 8 }, () => refundBuild(owner, chargedBuild)));
      assert.equal(await getBalance(owner), 0);
      const refunds = await db.select().from(creditEvents)
        .where(eq(creditEvents.idempotencyKey, `refund:${chargedBuild}`));
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0].delta, 1);
    });
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(user).where(eq(user.id, other));
    await close();
  }
});
