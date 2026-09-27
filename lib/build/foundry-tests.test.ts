import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compile, runTests } from "./foundry";
import { requiredTestsFailure } from "./completion";

test("Foundry executes nested suites and reports empty and failing test runs honestly", {
  skip: !process.env.FLETCH_TEST_WEB_IMAGE, timeout: 30_000,
}, async function foundry(t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-foundry-tests-"));
  const previousImage = process.env.FORGE_AGENT_IMAGE;
  const previousSandbox = process.env.FORGE_AGENT_SANDBOX;
  process.env.FORGE_AGENT_IMAGE = process.env.FLETCH_TEST_WEB_IMAGE;
  process.env.FORGE_AGENT_SANDBOX = "docker";
  try {
    await t.test("removed contracts cannot survive in fresh compiler evidence", async function freshArtifacts() {
      await mkdir(join(root, "contracts"));
      await mkdir(join(root, ".kimi"));
      await writeFile(join(root, ".kimi", "session.json"), "saved conversation");
      const source = join(root, "contracts", "App.sol");
      await writeFile(source, "pragma solidity ^0.8.28; contract Old { function oldValue() public pure returns (uint) { return 1; } } contract Current { function value() public pure returns (uint) { return 2; } }");
      const before = await compile(root, ["contracts/App.sol"]);
      assert.equal(before.ok, true);
      assert.deepEqual(before.contracts.map((contract) => contract.name).sort(), ["Current", "Old"]);
      const current = "pragma solidity ^0.8.28; contract Current { function value() public pure returns (uint) { return 3; } }";
      await writeFile(source, current);
      const after = await compile(root, ["contracts/App.sol"]);
      assert.equal(after.ok, true);
      assert.deepEqual(after.contracts.map((contract) => contract.name), ["Current"]);
      await assert.rejects(readFile(join(root, "out", "App.sol", "Old.json")), { code: "ENOENT" });
      assert.equal(await readFile(source, "utf8"), current);
      assert.equal(await readFile(join(root, ".kimi", "session.json"), "utf8"), "saved conversation");
    });
    await t.test("duplicate source basenames retain the compiler's actual source identity", async function sourceIdentity() {
      await mkdir(join(root, "contracts", "nested"));
      await writeFile(join(root, "contracts", "App.sol"), 'pragma solidity ^0.8.28; import "./nested/App.sol"; contract Top { function value() public pure returns (uint) { return 1; } }');
      await writeFile(join(root, "contracts", "nested", "App.sol"), "pragma solidity ^0.8.28; contract Nested { function value() public pure returns (uint) { return 2; } }");
      const report = await compile(root, ["App.sol"]);
      assert.equal(report.ok, true);
      assert.deepEqual(report.contracts.map(({ name, source }) => ({ name, source })).sort((a, b) => a.name.localeCompare(b.name)), [
        { name: "Nested", source: "contracts/nested/App.sol" },
        { name: "Top", source: "contracts/App.sol" },
      ]);
    });
    await t.test("tests absent is distinct from passing tests", async function absent() {
      assert.equal(await runTests(root), null);
    });
    await mkdir(join(root, "test", "flows"), { recursive: true });
    await writeFile(join(root, "test", "flows", "Actions.t.sol"), "pragma solidity ^0.8.28; contract Actions { function testBuy() public pure { assert(true); } function testClaim() public pure { assert(true); } }");
    await t.test("nested executable tests run in the actual sandbox", async function nested() {
      const result = await runTests(root);
      assert.equal(result?.total, 2);
      assert.equal(result?.passed, 2);
      assert.equal(result?.exitCode, 0);
      assert.equal(requiredTestsFailure(result), null);
    });
    await writeFile(join(root, "test", "flows", "Actions.t.sol"), "pragma solidity ^0.8.28; contract Actions { function helper() public pure {} }");
    await t.test("a test file with no executable tests does not pass completion", async function empty() {
      const result = await runTests(root);
      assert.equal(result?.passed, 0);
      assert.ok(requiredTestsFailure(result), "An empty Foundry suite cannot satisfy required test execution");
    });
    await writeFile(join(root, "test", "flows", "Actions.t.sol"), "pragma solidity ^0.8.28; contract Actions { function testBuy() public pure { assert(false); } }");
    await t.test("nonzero exit and the failed case are both preserved", async function failing() {
      const result = await runTests(root);
      assert.equal(result?.failed, 1);
      assert.notEqual(result?.exitCode, 0);
      assert.match(requiredTestsFailure(result)!, /1 of 1 tests failed/);
    });
    await rm(join(root, "test"), { recursive: true });
    await mkdir(join(root, "test"));
    await symlink("/tmp", join(root, "test", "outside"));
    await t.test("test discovery does not follow directory symlinks", async function links() {
      assert.equal(await runTests(root), null);
    });
  } finally {
    if (previousImage === undefined) delete process.env.FORGE_AGENT_IMAGE;
    else process.env.FORGE_AGENT_IMAGE = previousImage;
    if (previousSandbox === undefined) delete process.env.FORGE_AGENT_SANDBOX;
    else process.env.FORGE_AGENT_SANDBOX = previousSandbox;
    await rm(root, { recursive: true, force: true });
  }
});
