import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./redact";

test("provider diagnostics preserve the error while hiding credentials", function () {
  const old = process.env.REVIEW_API_KEY;
  const fixture = ["fixture", "secret", "123456"].join("-");
  process.env.REVIEW_API_KEY = fixture;
  try {
    const clean = redactSecrets(`HTTP 429 https://rpc.example/v2/${fixture} key=${fixture}`);
    assert.match(clean, /HTTP 429/);
    assert.ok(!clean.includes(fixture));
    assert.equal(redactSecrets("https://api.telegram.org/bot123456:fixture_bot_token/getMe"), "https://api.telegram.org/bot[redacted]/getMe");
  } finally {
    if (old === undefined) delete process.env.REVIEW_API_KEY;
    else process.env.REVIEW_API_KEY = old;
  }
});
