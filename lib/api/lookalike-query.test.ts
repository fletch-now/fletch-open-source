import assert from "node:assert/strict";
import { test } from "node:test";
import { lookalikeQuery, LOOKALIKE_KINDS } from "./lookalike-query";
import { openApiDocument } from "./openapi";

test("lookalike query preserves pagination defaults and normalizes page filters", function filters() {
  assert.deepEqual(lookalikeQuery(new URLSearchParams()), { symbol: undefined, kind: undefined, limit: 300, offset: 0 });
  assert.deepEqual(lookalikeQuery(new URLSearchParams("symbol=%24nvda&kind=unlisted_stock&limit=25&offset=50")), { symbol: "NVDA", kind: "unverified", limit: 25, offset: 50 });
  assert.deepEqual(lookalikeQuery(new URLSearchParams("kind=same_ticker&limit=9999&offset=9999999")), { symbol: undefined, kind: "same_ticker", limit: 1000, offset: 1000000 });
  for (const query of ["kind=unknown", "kind=impostor&kind=same_ticker", "symbol=" + "x".repeat(65), "q=NVDA"]) assert.throws(() => lookalikeQuery(new URLSearchParams(query)));
});

test("OpenAPI lookalike kinds match accepted filters and retain the legacy array", function schema() {
  const operation = openApiDocument.paths["/chains/{chainId}/lookalikes"].get;
  const kind = operation.parameters.find((parameter) => parameter.name === "kind");
  assert.ok(kind && "enum" in kind.schema);
  assert.deepEqual(kind.schema.enum, LOOKALIKE_KINDS);
  const response = operation.responses["200"].content["application/json"].schema as { required: string[]; properties: Record<string, unknown> };
  assert.deepEqual(response.required, ["lookalikes"]);
  for (const field of ["total", "limit", "offset", "nextOffset"]) assert.ok(field in response.properties);
});
