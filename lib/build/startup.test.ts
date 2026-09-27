import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "../../instrumentation";

test("production static workers and nonproduction imports never start build services", async function startup(t) {
  const original = { ...process.env };
  t.after(function restore() { process.env = original; });
  process.env = { ...process.env, NODE_ENV: "production" };
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.NEXT_PHASE = "phase-production-build";
  delete process.env.DATABASE_URL;
  delete process.env.BETTER_AUTH_SECRET;
  // Missing configuration would throw if the static worker reached startup.
  await register();
  process.env = { ...process.env, NODE_ENV: "test" };
  delete process.env.NEXT_PHASE;
  await register();
  process.env = { ...process.env, NODE_ENV: "production" };
  await assert.rejects(register(), /missing required environment/);
});
