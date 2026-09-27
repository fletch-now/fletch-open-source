import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import test from "node:test";
import { openSourceFile } from "./source-file";

test("source reads recall a transient lease while retaining no-follow and nonblocking flags", async function lease(t) {
  let attempts = 0;
  const handle = {} as Awaited<ReturnType<typeof fs.open>>;
  t.mock.method(fs, "open", async function open(_path: string, flags: number) {
    assert.equal(flags, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    attempts++;
    if (attempts <= 2) throw Object.assign(new Error("leased"), { code: "EAGAIN" });
    return handle;
  });
  assert.equal(await openSourceFile("controlled-fixture"), handle);
  assert.equal(attempts, 3);
});

test("persistent leases remain bounded and permanent source errors are not retried", async function errors(t) {
  let attempts = 0;
  let code = "ELOOP";
  t.mock.method(fs, "open", async function open() {
    attempts++;
    throw Object.assign(new Error("source unavailable"), { code });
  });
  await assert.rejects(openSourceFile("controlled-fixture"), { code: "ELOOP" });
  assert.equal(attempts, 1);
  attempts = 0;
  code = "EWOULDBLOCK";
  await assert.rejects(openSourceFile("controlled-fixture"), { code });
  assert.equal(attempts, 21);
});
