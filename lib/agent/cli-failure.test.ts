import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyAgentFailure } from "./cli-failure";

const hint = "See log: /work/.kimi-code/logs/kimi.log";

function providerError(status: number): string {
  return `Traceback (most recent call last):\nprovider.api_error: 400 The model provider returned ${status}.\n${hint}\n`;
}

test("mapped HTTP 429 survives the trailing CLI log hint without inventing its cause", function rejected() {
  const message = friendlyAgentFailure(hint, 1, providerError(429));
  assert.equal(message, "The model provider rejected the request (HTTP 429). Your source files are saved. Try again later or choose another model connection.");
  assert.doesNotMatch(message, /interrupted|rate.?limit|quota|exit|\/work\//i);
});

test("provider status is distinct from proxy 400 and CLI exit 1", function statuses() {
  for (const status of [401, 403]) assert.equal(friendlyAgentFailure(hint, 1, providerError(status)), `The model provider rejected access (HTTP ${status}). Your source files are saved. Check the selected provider connection.`);
  assert.match(friendlyAgentFailure(hint, 1, providerError(402)), /provider billing/);
  assert.equal(friendlyAgentFailure(hint, 1, providerError(503)), "The model provider returned HTTP 503. Your source files are saved. Provider usage may still be billed.");
  assert.match(friendlyAgentFailure(hint, 143, providerError(429)), /server restart/);
});

test("untrusted or unrelated stderr does not become a provider status", function unrelated() {
  for (const stderr of ["A tool printed 429", "provider.api_error: 400 Model request failed", "private-key-value"]) {
    assert.equal(friendlyAgentFailure(hint, 1, stderr), "The build agent stopped before finishing (exit 1). Provider usage may still be billed.");
  }
});
