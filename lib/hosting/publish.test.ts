import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishSite } from "./publish";

for (const scenario of ["certificate-failure", "https-failure", "first-failure", "confirmed"] as const) {
  test(`publication preserves the previous release until confirmation: ${scenario}`, async function publication() {
    const root = await mkdtemp(join(tmpdir(), "fletch-publish-confirmation-"));
    const previousRoot = process.env.FORGE_SITES_ROOT;
    const previousPath = process.env.PATH;
    const originalFetch = globalThis.fetch;
    const site = join(root, "sites", "fixture-app");
    try {
      await mkdir(join(root, "bin"));
      await mkdir(join(root, "dist"));
      await mkdir(join(site, "previous"), { recursive: true });
      await writeFile(join(site, "previous", "index.html"), "Previously confirmed app");
      if (scenario !== "first-failure") await symlink("previous", join(site, "current"));
      await writeFile(join(root, "dist", "index.html"), "Prepared replacement");
      await writeFile(join(root, "bin", "sudo"), `#!/bin/sh\nexit ${scenario === "certificate-failure" ? 1 : 0}\n`);
      await chmod(join(root, "bin", "sudo"), 0o755);
      process.env.PATH = `${join(root, "bin")}:${previousPath}`;
      process.env.FORGE_SITES_ROOT = join(root, "sites");
      let requests = 0;
      globalThis.fetch = async function verify(): Promise<Response> {
        requests++;
        assert.equal(await readlink(join(site, "current")), "candidate");
        return new Response("Controlled response", { status: scenario === "confirmed" ? 200 : 503 });
      };
      const result = await publishSite("fixture-app", "candidate", join(root, "dist"), 20);
      assert.equal(result.ok, scenario === "confirmed");
      assert.equal(requests, scenario === "certificate-failure" ? 0 : 1);
      if (scenario === "first-failure") await assert.rejects(readlink(join(site, "current")), { code: "ENOENT" });
      else assert.equal(await readlink(join(site, "current")), scenario === "confirmed" ? "candidate" : "previous");
      assert.equal(await readFile(join(site, "previous", "index.html"), "utf8"), "Previously confirmed app");
      assert.equal(await readFile(join(site, "candidate", "index.html"), "utf8"), "Prepared replacement");
    } finally {
      globalThis.fetch = originalFetch;
      process.env.PATH = previousPath;
      if (previousRoot === undefined) delete process.env.FORGE_SITES_ROOT;
      else process.env.FORGE_SITES_ROOT = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
}
