import type { TokenMetadataObservation } from "./priority-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { capitalizationMetric, tokenSupplyMetric, poolQuoteMetric, observedMetric, observationStatus, expiresAt, SUPPLY_FRESH_MS, METADATA_FRESH_MS } from "./metric-observation";
import { POOL_STATE_FRESH_MS } from "./authority/dex-state-freshness";
import { PRIORITY_STATE_FRESH_MS } from "./priority-model";
import { openApiDocument } from "../api/openapi";

const now = Date.parse("2026-09-10T20:00:00Z");
function at(age: number): string { return new Date(now - age).toISOString(); }
function supply(age: number): ReturnType<typeof observedMetric<string>> {
  return observedMetric("1000", "Pinned totalSupply", at(age), null,
    { maxAgeMs: SUPPLY_FRESH_MS, blockNumber: "100", blockHash: "0x123", fetchedAt: at(age - 1000), method: "erc20_totalSupply" }, now);
}
function inputs(): { decimals: ReturnType<typeof observedMetric<number>>; burn: ReturnType<typeof observedMetric<string>>; price: ReturnType<typeof observedMetric<number>> } {
  return {
    decimals: observedMetric(2, "ERC-20", at(60 * 60_000), null, { maxAgeMs: METADATA_FRESH_MS }, now),
    burn: observedMetric("100", "Burn balances", at(60_000), null, { maxAgeMs: SUPPLY_FRESH_MS }, now),
    price: observedMetric(2, "Pool", at(5000), null, { maxAgeMs: POOL_STATE_FRESH_MS }, now),
  };
}

test("capitalization retains every input time and expires with supply independently from fresh price", function () {
  const { decimals, burn, price } = inputs();
  const result = capitalizationMetric(decimals, supply(250_000), burn, price, now);
  assert.equal(result.value, 18);
  assert.equal(result.asOf, decimals.asOf);
  assert.equal(result.observation.expiresAt, at(-50_000));
  const raw = result.observation.inputs.find((input) => input.name === "totalSupplyRaw")!;
  assert.equal(raw.asOf, at(250_000));
  assert.equal(raw.observation.blockNumber, "100");
  assert.equal(raw.observation.fetchedAt, at(249_000));
  assert.notEqual(raw.observation.sourceAt, raw.observation.fetchedAt);
  const expired = capitalizationMetric(decimals, supply(SUPPLY_FRESH_MS + 1), burn, price, now);
  assert.equal(expired.value, null);
  assert.equal(expired.observation.status, "stale");
  assert.equal(expired.observation.readStatus, "partial");
  assert.equal(expired.observation.inputs.find((input) => input.name === "priceUsd")?.value, 2);
});

test("freshness is independent from latest read failures and never manufactures missing observations", function () {
  const retained = observedMetric("100", "RPC", at(10_000), "RPC unavailable", { maxAgeMs: SUPPLY_FRESH_MS, readStatus: "failed" }, now);
  assert.equal(retained.value, "100");
  assert.equal(retained.observation.status, "current");
  assert.equal(retained.observation.readStatus, "failed");
  const missing = observedMetric<number>(null, null, null, "Unread", {}, now);
  assert.equal(missing.asOf, null);
  assert.equal(missing.observation.sourceAt, null);
  assert.equal(missing.observation.fetchedAt, null);
  assert.equal(missing.observation.expiresAt, null);
  assert.equal(missing.observation.readStatus, "unread");
  assert.equal(expiresAt("invalid", 1), null);
  assert.equal(observationStatus(at(-1), at(-1000), now), "invalid");
  assert.equal(observationStatus("invalid", at(-1000), now), "invalid");
  assert.equal(observationStatus(at(SUPPLY_FRESH_MS), at(0), now), "current");
});

test("capitalization withholds missing burn data, preserves confirmed zero and rejects burns exceeding supply", function () {
  const { decimals, burn, price } = inputs();
  const missing = observedMetric<string>(null, null, null, "Unread", {}, now);
  assert.equal(capitalizationMetric(decimals, supply(1), missing, price, now).value, null);
  assert.equal(capitalizationMetric(decimals, supply(1), { ...burn, value: "1000" }, price, now).value, 0);
  assert.equal(capitalizationMetric(decimals, supply(1), { ...burn, value: "1001" }, price, now).value, null);
});

test("public metric schema includes recursive input evidence and unified pool expiry", function () {
  assert.equal(PRIORITY_STATE_FRESH_MS, POOL_STATE_FRESH_MS);
  assert.equal(POOL_STATE_FRESH_MS, 180_000);
  const schema = openApiDocument.components.schemas.MetricObservation;
  for (const field of ["sourceId", "blockNumber", "blockHash", "sourceAt", "fetchedAt", "expiresAt", "method", "inputs", "coverage", "readStatus", "status"]) {
    assert.ok(schema.required.includes(field));
  }
  assert.equal(schema.properties.inputs.items.properties.observation.$ref, "#/components/schemas/MetricObservation");
});


test("supply refresh keeps identity and burn observation times independent and retains failed-read evidence", function () {
  const metadata: TokenMetadataObservation = {
    bytecodePresent: true, name: "Fixture", symbol: "FIX", decimals: 2,
    totalSupplyRaw: "1000", burnedRaw: "10", source: "RPC metadata", asOf: at(3_600_000), blockNumber: "1", blockHash: "old", reason: null,
    supply: { value: "1100", source: "RPC supply", asOf: at(10_000), fetchedAt: at(9000), blockNumber: "2", blockHash: "new", reason: null },
    supplyError: "Latest RPC failed", supplyAttemptedAt: at(1000),
  };
  const currentSupply = tokenSupplyMetric(metadata, "supply", 4663, "fixture", now);
  assert.equal(currentSupply.value, "1100");
  assert.equal(currentSupply.asOf, at(10_000));
  assert.equal(currentSupply.observation.blockNumber, "2");
  assert.equal(currentSupply.observation.fetchedAt, at(9000));
  assert.equal(currentSupply.observation.readStatus, "failed");
  const staleBurn = tokenSupplyMetric(metadata, "burn", 4663, "fixture", now);
  assert.equal(staleBurn.value, null);
  assert.equal(staleBurn.asOf, at(3_600_000));
  assert.equal(staleBurn.observation.status, "stale");
  const failed = tokenSupplyMetric({ ...metadata, supply: { ...metadata.supply!, value: null, reason: "Failed" } }, "supply", 4663, "fixture", now);
  assert.equal(failed.value, null, "a failed nested observation cannot borrow a differently timed legacy value");
});


test("quote conversion distinguishes source time, fetch freshness and explicit fixed USDG assumptions", function () {
  const quote = { value: 2000, source: "ETH/USD feed", sourceId: "rpc:feed:fixture", sourceAt: at(60_000), fetchedAt: at(5000),
    expiresAt: at(-175_000), method: "chainlink_eth_usd", blockNumber: null, blockHash: null, parameters: {}, reason: null };
  const result = poolQuoteMetric(quote, at(1000), quote.source, now);
  assert.equal(result.value, 2000);
  assert.equal(result.asOf, at(60_000));
  assert.equal(result.observation.fetchedAt, at(5000));
  assert.equal(poolQuoteMetric({ ...quote, expiresAt: at(1) }, at(1000), quote.source, now).value, null);
  assert.equal(poolQuoteMetric({ ...quote, fetchedAt: at(-1) }, at(1000), quote.source, now).observation.status, "invalid");
  const nominal = poolQuoteMetric({ ...quote, value: 1, sourceAt: null, method: "fixed_notional_usdg", parameters: { assumption: "1 USDG = 1 USD" } }, at(1000), "USDG assumption", now);
  assert.equal(nominal.value, 1);
  assert.equal(nominal.observation.sourceAt, null);
  assert.equal(nominal.observation.method, "fixed_notional_usdg");
  const legacy = poolQuoteMetric(null, at(1000), "Old prose", now);
  assert.equal(legacy.observation.fetchedAt, null);
  assert.equal(legacy.observation.status, "missing");
});
