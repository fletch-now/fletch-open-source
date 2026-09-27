import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "@/app/api/v1/docs/assets/[file]/route";

test("API reference serves its complete allow-listed assets and rejects inherited names", async () => {
  for (const [file, type] of [["css", "text/css"], ["bundle", "application/javascript"], ["preset", "application/javascript"]]) {
    const response = await GET(new Request(`http://localhost/api/v1/docs/assets/${file}`), { params: Promise.resolve({ file }) });
    assert.equal(response.status, 200, file);
    assert.ok(response.headers.get("content-type")?.startsWith(type));
    assert.ok((await response.arrayBuffer()).byteLength > 10000);
    assert.doesNotMatch(response.headers.get("cache-control") ?? "", /immutable/);
  }
  for (const file of ["constructor", "toString", "__proto__", "../../package.json", "unknown"]) {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ file }) });
    assert.equal(response.status, 404, file);
  }
});
