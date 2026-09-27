import assert from "node:assert/strict";
import { test } from "node:test";
import { assetsQuery } from "./assets-query";
import { SORT_LABEL } from "@/lib/registry/asset-sort";
import { openApiDocument } from "./openapi";

test("asset browsing opts into global ordering and bounded pagination without changing legacy reads", function query() {
  const legacy = assetsQuery(new URLSearchParams("symbols=NVDA,AAPL"));
  assert.equal(legacy.browse, false);
  assert.equal(legacy.page, undefined);
  const parsed = assetsQuery(new URLSearchParams("q=NV&type=stock_token&verified=1&state=feed&sort=price&order=asc&limit=25&offset=50"));
  assert.equal(parsed.browse, true);
  assert.deepEqual(parsed.page, { limit: 25, offset: 50 });
  assert.deepEqual(parsed.filters, { q: "NV", type: "stock_token", verified: "1", state: "feed", sort: "price", order: "asc" });
  assert.equal(assetsQuery(new URLSearchParams("sort=price")).filters.order, "desc");
  assert.equal(assetsQuery(new URLSearchParams("limit=25")).filters.order, "asc");
  for (const query of ["sort=constructor", "sort=unknown", "sort=name&sort=price", "order=ASC", "order=asc&order=desc", "type=constructor", "state=nope", "verified=yes", "limit=0", "limit=51", "limit=2.5", "offset=-1", "offset=1000001", "ordr=desc"]) {
    assert.throws(() => assetsQuery(new URLSearchParams(query)), query);
  }
});

test("assets OpenAPI describes all table sort keys and opt-in pagination", function schema() {
  const operation = openApiDocument.paths["/chains/{chainId}/assets"].get;
  const sort = operation.parameters.find((parameter) => parameter.name === "sort");
  assert.ok(sort && "enum" in sort.schema);
  assert.deepEqual(sort.schema.enum, Object.keys(SORT_LABEL));
  for (const key of ["order", "type", "state", "verified", "limit", "offset"]) assert.ok(operation.parameters.some((parameter) => parameter.name === key));
  const response = operation.responses["200"].content["application/json"].schema as { properties: Record<string, unknown> };
  for (const key of ["total", "limit", "offset", "nextOffset", "assets"]) assert.ok(key in response.properties);
});
