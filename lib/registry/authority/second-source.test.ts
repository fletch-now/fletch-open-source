import assert from "node:assert/strict";
import { test } from "node:test";
import { BlockscoutUnavailableError, tokenInfo } from "./blockscout";
import { refreshSecondSource } from "./second-source";
import type { TrackedAsset } from "./assets";

const assets: TrackedAsset[] = [1, 2, 3].map((index) => ({ id: `fixture${index}`, chainId: 4663, address: `0x${index.toString().padStart(40, "0")}`, symbol: `FX${index}`, name: `Fixture ${index}`, assetType: "stock_token", decimals: 18 }));

test("Blockscout access denial is explicit and does not retry a challenge", async function (t) {
  let calls = 0;
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async function refused() {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403, headers: { "content-type": "text/html" } });
  });
  await assert.rejects(tokenInfo(assets[0].address), (error: unknown) => error instanceof BlockscoutUnavailableError && error.message.includes("HTTP 403"));
  assert.equal(calls, 1);
  assert.equal(cancelled, true, "denied response bodies must release their connection before retrying later");
});

test("a provider-wide Blockscout denial stops the run instead of repeating it for every asset", async function () {
  let called = 0;
  await assert.rejects(refreshSecondSource(4663, async function unavailable() {
    called++;
    throw new BlockscoutUnavailableError("Blockscout denied API access (HTTP 403)");
  }, async () => assets, async () => new Map()), /HTTP 403/);
  assert.equal(called, 1);
});

test("second-source saves successful assets, reports partial failure and resumes only remaining due assets", async function () {
  const now = new Date("2026-09-08T12:00:00Z");
  const observed = new Map<string, Date>();
  const calls: string[] = [];
  let failing = true;
  async function read(asset: TrackedAsset) {
    calls.push(asset.id);
    if (failing && asset.id === assets[0].id) throw new Error("individual endpoint HTTP500");
    observed.set(asset.id, new Date(now));
    return "agree" as const;
  }
  const run = () => refreshSecondSource(4663, read, async () => assets, async () => observed, () => now);
  await assert.rejects(run(), /1\/3 observations still due; 1 failed assets: fixture1/);
  assert.equal(observed.size, 2, "unrelated successful observations must survive the failed run");
  assert.equal(observed.has(assets[0].id), false, "failed endpoint cannot make an asset fresh");
  failing = false;
  const resumed = await run();
  assert.deepEqual(calls, ["fixture1", "fixture2", "fixture3", "fixture1"]);
  assert.equal(resumed.rows, 1);
  assert.equal(resumed.detail?.skippedFresh, 2);
  assert.equal(resumed.detail?.remaining, 0);
  assert.equal((await run()).rows, 0, "another restart cannot spend quota re-reading the fresh pass");
});

test("second-source cadence uses per-asset actual timestamps and never trusts a future observation", async function () {
  const now = new Date("2026-09-08T12:00:00Z");
  const observed = new Map<string, Date>([
    ["fixture1", new Date(now.getTime() - 3_600_000)],
    ["fixture2", new Date(now.getTime() - 3_600_000 + 1)],
    ["fixture3", new Date(now.getTime() + 1)],
  ]);
  const calls: string[] = [];
  await refreshSecondSource(4663, async function read(asset) {
    calls.push(asset.id);
    observed.set(asset.id, now);
    return "agree";
  }, async () => assets, async () => observed, () => now);
  assert.deepEqual(calls, ["fixture1", "fixture3"]);
});
