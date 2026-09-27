import assert from "node:assert/strict";

const base = new URL(process.argv[2] ?? "https://builder.example.com");
const chainId = "4663";
const report = [];

async function get(path, expectedStatus = 200) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, expectedStatus, path);
  return response.json();
}

try {
  const spec = await get("/api/v1/openapi.json");
  const contract = spec.paths["/chains/{chainId}/assets"].get.responses["200"].content["application/json"].schema;
  const levels = contract.properties.assets.items.allOf[1].properties.trust.properties.level.enum;
  const collection = await get(`/api/v1/chains/${chainId}/assets`);
  assert.ok(collection.assets.length > 0, "Acceptance needs at least one recorded asset");
  for (const asset of collection.assets) {
    assert.ok(levels.includes(asset.trust.level), `${asset.symbol} returned an undocumented trust level`);
    assert.equal(typeof asset.trust.label, "string");
    assert.equal(typeof asset.trust.detail, "string");
  }
  report.push({ check: "collection matches generated trust schema", assets: collection.assets.length });
  const first = collection.assets[0];
  const single = await get(`/api/v1/chains/${chainId}/assets/${encodeURIComponent(first.symbol)}`);
  const resolved = await get(`/api/v1/tokens/${first.address}`);
  assert.equal(single.trust.level, first.trust.level);
  assert.equal(resolved.trust, single.trust.level);
  report.push({ check: "collection, symbol and address endpoints agree", symbol: first.symbol, trust: single.trust.level });
  for (const level of levels) {
    const filtered = await get(`/api/v1/chains/${chainId}/assets?trust=${level}`);
    assert.ok(filtered.assets.every((asset) => asset.trust.level === level), `trust=${level} was not applied`);
    report.push({ check: `trust=${level}`, assets: filtered.assets.length });
  }
  const invalid = await get(`/api/v1/chains/${chainId}/assets?trust=invalid`, 400);
  assert.equal(typeof invalid.error, "string");
  report.push({ check: "invalid trust filter returns an error" });
  console.log(JSON.stringify({ base: base.origin, checkedAt: new Date().toISOString(), passed: true, report }));
} catch (error) {
  console.error(JSON.stringify({ base: base.origin, checkedAt: new Date().toISOString(), passed: false, report, error: error.message }));
  process.exitCode = 1;
}
