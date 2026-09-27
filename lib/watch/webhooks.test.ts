// Run with: node --import tsx --test lib/watch/webhooks.test.ts
//
// The signed string and the URL rules are this feature's public contract: every
// receiver in the world verifies the first, and the second is what keeps a
// delivery off Fletch's own network. Both are pure, so both are pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidWebhookUrlError, normalizeWebhookUrl, signWebhookBody } from "@/lib/watch/webhooks";

// A vector, not a re-derivation: recomputing the HMAC in the test would pass
// against any construction, including a changed one.
test("signWebhookBody: known secret, timestamp and body sign to a fixed digest", function () {
  const body = JSON.stringify({ id: "dl_1", kind: "ping" });
  assert.equal(
    signWebhookBody("whsec_test", body, 1_789_200_000),
    "t=1789200000,v1=569d98064e3f7b009e0cd8a66ee708840ecc73875b0705963c73b5142e118c68",
  );
});

test("normalizeWebhookUrl: a public https URL passes through", function () {
  assert.equal(normalizeWebhookUrl("  https://example.com/fletch  "), "https://example.com/fletch");
});

test("normalizeWebhookUrl: plain http on a public host is refused", function () {
  assert.throws(() => normalizeWebhookUrl("http://example.com/fletch"), InvalidWebhookUrlError);
});

test("normalizeWebhookUrl: credentials in the URL are refused", function () {
  assert.throws(() => normalizeWebhookUrl("https://user:pass@example.com/fletch"), InvalidWebhookUrlError);
});

test("normalizeWebhookUrl: private and link-local addresses are refused", function () {
  for (const url of [
    "https://10.1.2.3/hook",
    "https://192.168.0.9/hook",
    "https://172.16.4.4/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://0.0.0.0/hook",
    "https://box.internal/hook",
    "https://printer.local/hook",
  ]) {
    assert.throws(() => normalizeWebhookUrl(url), InvalidWebhookUrlError, url);
  }
});

// NODE_ENV is read-only in the app's ambient types, and the loopback rule reads
// it at call time; the plain record view is how a test moves it and puts it back.
function withNodeEnv(value: string, run: () => void): void {
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    run();
  } finally {
    env.NODE_ENV = before;
  }
}

// The URL parser rewrites these to hex groups ("[::ffff:7f00:1]"), which is why
// they are checked as addresses rather than matched as text.
test("normalizeWebhookUrl: IPv6 literals, mapped IPv4 included, are refused", function () {
  withNodeEnv("production", function checkAll() {
    for (const url of [
      "https://[::1]/hook",
      "https://[::]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://[::ffff:10.0.0.1]/hook",
      "https://[fd00::1]/hook",
      "https://[fe80::1]/hook",
    ]) {
      assert.throws(() => normalizeWebhookUrl(url), InvalidWebhookUrlError, url);
    }
  });
});

// Loopback over http is how a local check receives a signed ping; in production
// it is refused like any other private address.
test("normalizeWebhookUrl: loopback is allowed off production and refused on it", function () {
  withNodeEnv("development", function allowed() {
    assert.equal(normalizeWebhookUrl("http://localhost:4000/hook"), "http://localhost:4000/hook");
    assert.equal(normalizeWebhookUrl("http://127.0.0.1:4000/hook"), "http://127.0.0.1:4000/hook");
  });
  withNodeEnv("production", function refused() {
    assert.throws(() => normalizeWebhookUrl("http://localhost:4000/hook"), InvalidWebhookUrlError);
    assert.throws(() => normalizeWebhookUrl("https://127.0.0.1/hook"), InvalidWebhookUrlError);
  });
});

// DNS answers are validated at socket lookup, including every alternative.
test("resolved webhook addresses exclude private, mixed and transition networks", async function (): Promise<void> {
  const { validateWebhookAddresses, webhookRetryAfterMs } = await import("@/lib/watch/webhooks");
  withNodeEnv("production", function check(): void {
    for (const address of ["127.0.0.1", "10.0.0.1", "100.100.100.100", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:7f00:1", "ff02::1", "2002:7f00:1::", "2001:0:1::"]) {
      assert.throws(() => validateWebhookAddresses([{ address: "8.8.8.8", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }]), InvalidWebhookUrlError);
    }
    validateWebhookAddresses([{ address: "8.8.8.8", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }]);
  });
  assert.equal(webhookRetryAfterMs("60"), 60_000);
  assert.equal(webhookRetryAfterMs("invalid"), undefined);
  assert.equal(webhookRetryAfterMs("-1"), undefined);
  assert.equal(webhookRetryAfterMs(new Date(120_000).toUTCString(), 60_000), 60_000);
});
