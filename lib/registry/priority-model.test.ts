import assert from "node:assert/strict";
import { test } from "node:test";
import { selectPriority, strongestPool, tokenGroups, type PriorityCandidate, type PriorityPool } from "./priority-model";
const now = new Date("2026-09-09T17:00:00Z");
const address = (id: number) => `0x${id.toString(16).padStart(40, "0")}`;
function token(id: number, symbol: string, pools: PriorityPool[] = [], listed = false): PriorityCandidate {
  return { address: address(id), assetId: listed ? `listed-${id}` : null, symbol, name: symbol, holders: null, pools };
}
function pool(id: number, depth: number, method: PriorityPool["method"] = "v3_quote_holdings"): PriorityPool {
  return { id: address(id), address: address(id), method, depthUsd: depth, priceUsd: 1, observedAt: now.toISOString(), reason: null, createdBlock: "10", lastSwapAt: null };
}
test("every listed identity stays present even without pool measurements", () => {
  const rows = selectPriority(4663, Array.from({ length: 207 }, (_, index) => token(index + 1, `LISTED${index}`, [], true)), now);
  assert.equal(rows.filter((row) => row.role === "listed").length, 207);
  assert.equal(new Set(rows.map((row) => row.address)).size, 207);
});
test("normalized name and symbol matches share an explicit alternatives group", () => {
  const left = token(1, "CASH-CAT", [pool(11, 20_000)]);
  const right = token(2, "OTHER", [pool(12, 10_000)]); right.name = "cash cat";
  assert.equal(tokenGroups([left, right]).length, 1);
  const rows = selectPriority(4663, [right, left], now);
  assert.equal(rows.find((row) => row.address === left.address)?.role, "community");
  assert.equal(rows.find((row) => row.address === right.address)?.role, "alternative");
  assert.ok(rows.every((row) => row.dominantAddress === left.address));
});
test("dominance uses the strongest single V3 pool, never a sum of fee tiers", () => {
  const left = token(1, "PONS", [pool(11, 19_000)]);
  const right = token(2, "PONS", [pool(12, 11_000), pool(13, 11_000)]);
  const rows = selectPriority(4663, [right, left], now);
  assert.equal(rows.find((row) => row.role === "community")?.address, left.address);
  assert.equal(strongestPool(right, "v3_quote_holdings", now.getTime())?.depthUsd, 11_000);
});
test("large V4 upper bound never numerically outranks qualifying V3 holdings", () => {
  const rows = selectPriority(4663, [token(1, "CASHCAT", [pool(11, 20_000)]), token(2, "CASHCAT", [pool(12, 9_000_000, "v4_bounded_one_percent")])], now);
  assert.equal(rows.find((row) => row.role === "community")?.address, address(1));
  assert.match(rows[0].selectionReason, /not compared or added/);
});
test("V4 selection exposes same-method close calls and stable holder tie breaks", () => {
  const left = token(1, "OPAI", [pool(11, 10_000, "v4_bounded_one_percent")]);
  const right = token(2, "OPAI", [pool(12, 10_000, "v4_bounded_one_percent")]); right.holders = 12;
  const rows = selectPriority(4663, [left, right], now);
  assert.equal(rows.find((row) => row.role === "community")?.address, right.address);
  assert.ok(rows.every((row) => row.closeCall));
});
test("named floors retain unavailable tokens without invented dominance; stale pools do not qualify", () => {
  const stale = pool(11, 999_999); stale.observedAt = "2026-09-08T17:00:00Z";
  const rows = selectPriority(4663, [token(1, "PIPEDOG", [stale]), token(2, "EMPTY", [pool(12, 0)])], now);
  assert.equal(rows.length, 1); assert.equal(rows[0].dominantAddress, null);
  assert.match(rows[0].selectionReason, /No fresh/);
});

test("a listed identity never lends its listing claim to a same-name alternative", () => {
  const rows = selectPriority(4663,[token(1,"STOCK",[],true),token(2,"STOCK",[pool(20,50_000)]),token(3,"STOCK",[],true)],now);
  assert.equal(rows.find((row)=>row.address===address(3))?.dominantAddress,address(3));
  assert.match(rows.find((row)=>row.address===address(2))?.selectionReason ?? "",/different address/);
});


test("new app catalog symbols enter comparison without changing liquidity dominance", function catalogAdmission() {
  const now = new Date();
  const candidates = [1, 2].map((id) => ({ address: `0x${String(id).repeat(40)}`, assetId: null, symbol: "FRONG", name: "frong", holders: null, pools: [{ id: `pool-${id}`, address: `0x${String(id).repeat(40)}`, method: "v4_bounded_one_percent" as const, depthUsd: id * 20, priceUsd: 1, observedAt: now.toISOString(), reason: null, createdBlock: "1", lastSwapAt: null }] }));
  assert.equal(selectPriority(4663, candidates, now).length, 0);
  const included = selectPriority(4663, candidates, now, ["FRONG"]);
  assert.equal(included.length, 2);
  assert.equal(included.find((row) => row.role === "community")?.address, candidates[1].address);
  assert.ok(included.every((row) => row.dominantAddress === null), "weak depth cannot establish dominance just because the ticker is in the app");
});
