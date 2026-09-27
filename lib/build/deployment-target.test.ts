import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keccak256, type Abi, type Hex } from "viem";
import { DEPLOYMENT_MANIFEST, selectDeploymentTarget } from "./deployment-target";
import type { ContractSummary } from "./types";

async function fixture(root: string, name: string, bytecode: Hex, abi: Abi = []): Promise<ContractSummary> {
  const directory = join(root, "out", `${name}.sol`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), JSON.stringify({ abi, bytecode: { object: bytecode },
    metadata: { settings: { compilationTarget: { [`contracts/${name}.sol`]: name } } } }));
  return { name, source: `contracts/${name}.sol`, bytecodeBytes: (bytecode.length - 2) / 2, functions: 0, events: 0, abi: [...abi] };
}

test("deployment uses an explicit compiled entrypoint and never guesses by size", async function selection(t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-deployment-target-"));
  try {
    const small = await fixture(root, "Factory", "0x6001600055");
    const large = await fixture(root, "Token", "0x60016000556002600055");
    const manifest = join(root, DEPLOYMENT_MANIFEST);
    await t.test("one existing eligible contract remains supported without a manifest", async function single() {
      assert.equal((await selectDeploymentTarget(root, [small]))?.summary.name, "Factory");
    });
    await t.test("ambiguous contracts fail even when their sizes differ", async function ambiguous() {
      await assert.rejects(selectDeploymentTarget(root, [small, large]), /Several contracts/);
    });
    await t.test("unchanged deployed bytecode preserves the existing entrypoint", async function retained() {
      assert.equal((await selectDeploymentTarget(root, [small, large], keccak256("0x6001600055")))?.summary.name, "Factory");
    });
    await t.test("manifest chooses the smaller factory explicitly", async function explicit() {
      await writeFile(manifest, JSON.stringify({ version: 1, source: small.source, contract: small.name }));
      assert.equal((await selectDeploymentTarget(root, [small, large]))?.summary.name, "Factory");
    });
    await t.test("an invalid or absent manifest target never silently falls back", async function invalid() {
      for (const value of [
        "{broken",
        JSON.stringify({ version: 1, source: small.source, contract: "Missing" }),
        JSON.stringify({ version: 1, source: "../outside.sol", contract: small.name }),
        JSON.stringify({ version: 1, source: small.source, contract: small.name, extra: "ignored?" }),
      ]) {
        await writeFile(manifest, value);
        await assert.rejects(selectDeploymentTarget(root, [small]), /fletch\.deploy\.json/);
      }
    });
    await t.test("manifest symlinks cannot substitute another file", async function linked() {
      await rm(manifest);
      await writeFile(join(root, "selection.json"), JSON.stringify({ version: 1, source: small.source, contract: small.name }));
      await symlink("selection.json", manifest);
      await assert.rejects(selectDeploymentTarget(root, [small]), /readable regular file/);
      await rm(manifest);
    });
    await t.test("test contracts and unsupported constructors are excluded", async function excluded() {
      const support = await fixture(root, "FactoryTest", "0x6003600055");
      const unsupported = await fixture(root, "Custom", "0x6004600055", [{ type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }] }]);
      assert.equal(await selectDeploymentTarget(root, [support, unsupported]), null);
      await writeFile(manifest, JSON.stringify({ version: 1, source: support.source, contract: support.name }));
      await assert.rejects(selectDeploymentTarget(root, [small, support]), /one compiled application contract/);
      await rm(manifest);
    });
    await t.test("a duplicate bytecode match still requires an explicit target", async function duplicate() {
      const other = await fixture(root, "OtherFactory", "0x6001600055");
      await assert.rejects(selectDeploymentTarget(root, [small, other], keccak256("0x6001600055")), /Several contracts/);
    });
    await t.test("the artifact's compiler source identity must match the selected contract", async function identity() {
      const mismatched = await fixture(root, "Nested", "0x6005600055");
      await writeFile(join(root, "out", "Nested.sol", "Nested.json"), JSON.stringify({ abi: [], bytecode: { object: "0x6005600055" },
        metadata: { settings: { compilationTarget: { "contracts/nested/Nested.sol": "Nested" } } } }));
      await writeFile(manifest, JSON.stringify({ version: 1, source: mismatched.source, contract: mismatched.name }));
      await assert.rejects(selectDeploymentTarget(root, [mismatched]), /one compiled application contract/);
      await rm(manifest);
      await writeFile(join(root, "out", "Nested.sol", "Nested.json"), JSON.stringify({ abi: [], bytecode: { object: "0x6005600055" } }));
      assert.equal(await selectDeploymentTarget(root, [mismatched]), null);
    });
    await t.test("artifact paths cannot follow a symlink outside the workspace", async function escaped() {
      const outside = await mkdtemp(join(tmpdir(), "fletch-deployment-outside-"));
      try {
        await writeFile(join(outside, "Escaped.json"), JSON.stringify({ abi: [], bytecode: { object: "0x6001600055" } }));
        await symlink(outside, join(root, "out", "Escaped.sol"));
        const target = { ...small, name: "Escaped", source: "contracts/Escaped.sol" };
        assert.equal(await selectDeploymentTarget(root, [target]), null);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
