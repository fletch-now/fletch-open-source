import assert from "node:assert/strict";
import { test } from "node:test";
import { openApiDocument } from "./openapi";
import { StatusSchema } from "./status-schema";
import { publicFreshness, publicHolder } from "@/lib/registry/authority/shape";
import type { Freshness } from "@/lib/registry/authority/freshness";

test("both status endpoints document and serialize the measured metadata backlog", function () {
  const now = new Date("2026-09-08T15:00:00Z");
  const backlog = { total: 100, due: 90, visibleDue: 8, neverRead: 30, errors: 2, oldestCheckedAt: null, measuredAt: now.toISOString() };
  const reading: Freshness = {
    swapIndexer: { mode: "live_and_backwards", checkedAt: new Date(0).toISOString(), newestCountedBlock: null, newestCountedAt: null, headBlock: null, headReadAt: null, lagBlocks: null, lagSeconds: null, windowStartAt: null, windowEndAt: null, current: false, tiers: [], historicalUsdAvailable: false },
    chainId: 4663, checkedAt: now, verdict: "live", summary: "Metadata is still filling", head: null, figures: [],
    daemon: { name: "registry-daemon", lastBeatAt: now, ageMs: 0, alive: true, jobsReported: 31, failing: [] },
    jobs: [{ job: "dex-tokens", cadenceMs: 60_000, lastRunAt: now, lastOkAt: now, ageMs: 0, rows: 7, error: null, running: false, verdict: "filling", checkpoints: [], metadataBacklog: backlog }],
  };
  reading.scouting = { measuredAt: now.toISOString(), catalogSymbols: 3, matchedTickers: 2, bytecodeCheckedTickers: 1, unmatchedSymbols: ["UNMATCHED"], pendingPoolTokens: 7, selectedPools: 4, completeVolumePools: 3 };
  reading.lookalikes = { measuredAt: now.toISOString(), assets: 205, completed: 5, pending: 200, failed: 1,
    oldestCompletedAt: null, lastObservedAt: now.toISOString(), localCompletedAt: null, beaconPending: 8, beaconFailed: 2 };
  const encoded = JSON.parse(JSON.stringify(publicFreshness(reading)));
  assert.deepEqual(encoded.scouting, reading.scouting);
  assert.deepEqual(encoded.lookalikes, reading.lookalikes);
  assert.deepEqual([...StatusSchema.properties.lookalikes.required].sort(), Object.keys(reading.lookalikes).sort());
  assert.deepEqual(StatusSchema.properties.scouting.required, Object.keys(reading.scouting));
  assert.deepEqual(encoded.jobs[0].metadataBacklog, backlog);
  assert.equal(encoded.jobs[0].verdict, "filling");
  reading.jobs[0].metadataBacklog = undefined;
  assert.equal(publicFreshness(reading).jobs[0].metadataBacklog, null);
  for (const path of ["/status", "/chains/{chainId}/status"] as const) {
    assert.deepEqual(openApiDocument.paths[path].get.responses["200"].content["application/json"].schema, StatusSchema);
  }
  assert.deepEqual(StatusSchema.properties.jobs.items.properties.metadataBacklog.required, Object.keys(backlog));
});

test("an unlabelled holder is null and remains allowed by the published enum", function () {
  const holder = publicHolder({ assetId: "fixture", holder: `0x${"1".repeat(40)}`, rawBalance: "1", updatedBlock: BigInt(1) }, null, null);
  assert.equal(holder.labelKind, null);
  assert.equal(holder.sits, "unknown");
  const schema = openApiDocument.paths["/chains/{chainId}/assets/{symbol}/holders"].get.responses["200"].content["application/json"].schema;
  const contract = schema as { properties: { holders: { items: { properties: { labelKind: { enum: Array<string | null> } } } } } };
  assert.equal(contract.properties.holders.items.properties.labelKind.enum.includes(holder.labelKind), true);
});
