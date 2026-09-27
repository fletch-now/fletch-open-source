import assert from "node:assert/strict";
import { test } from "node:test";
import { keyMutationOriginAllowed } from "./key-origin";

test("key mutations validate the configured HTTPS origin behind an HTTP proxy", function origin() {
  const expected = "https://fletch.now";
  function request(origin?: string, site = "same-origin"): Request {
    const headers = new Headers({ "sec-fetch-site": site, "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" });
    if (origin) headers.set("origin", origin);
    return new Request("http://localhost:3000/api/model-keys", { method: "POST", headers });
  }
  assert.equal(keyMutationOriginAllowed(request(expected), expected), true);
  assert.equal(keyMutationOriginAllowed(request("http://localhost:3000"), expected), false);
  assert.equal(keyMutationOriginAllowed(request("https://forge-example.apps.fletch.now", "same-site"), expected), false);
  assert.equal(keyMutationOriginAllowed(request("https://attacker.example", "cross-site"), expected), false);
  assert.equal(keyMutationOriginAllowed(request(expected, "cross-site"), expected), false);
  assert.equal(keyMutationOriginAllowed(request(undefined), expected), false);
});
