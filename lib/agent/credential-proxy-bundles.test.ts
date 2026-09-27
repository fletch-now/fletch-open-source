import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { build } from "esbuild";
import type { CredentialLease } from "@/lib/agent/credential-proxy";
import type { ProviderConfig } from "@/lib/agent/provider";

interface Bundle {
  leaseCredential: (provider: ProviderConfig, reach: "local") => Promise<CredentialLease>;
  revokeCredentialLeases: (id: string) => void;
}

async function bundledProxy(): Promise<Bundle> {
  const result = await build({
    stdin: { contents: 'export { leaseCredential } from "@/lib/agent/credential-proxy"; export { revokeCredentialLeases } from "@/lib/agent/lease-revocation";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "controlled-auth-only", setup(plugin) {
      plugin.onResolve({ filter: /^(server-only|@\/lib\/agent\/(user-keys|provider-settings))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export async function credentialStillActive(){return true}; export async function providerIntegrationEnabled(){return true};", loader: "js" }));
    } }],
  });
  const compiled = { exports: {} as Bundle };
  // Execute only this repository's trusted bundled modules, as Next does for
  // separate instrumentation/route entrypoints. No model-authored code runs here.
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(`${process.cwd()}/package.json`), compiled, compiled.exports);
  return compiled.exports;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("separate compiled bundles share proxy leases and immediate revocation", async function bundles(t) {
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = (reserve.address() as AddressInfo).port;
  await closeServer(reserve);
  const previous = { ...process.env };
  process.env.FORGE_PROXY_BIND = "127.0.0.1";
  process.env.FORGE_PROXY_PORT = String(port);
  const globals = globalThis as typeof globalThis & { __fletchCredentialProxy?: { server?: Server }; __fletchCredentialRevocations?: Set<unknown> };
  const leases: CredentialLease[] = [];
  t.after(async function cleanup() {
    for (const lease of leases) lease.release();
    if (globals.__fletchCredentialProxy?.server) await closeServer(globals.__fletchCredentialProxy.server);
    delete globals.__fletchCredentialProxy;
    delete globals.__fletchCredentialRevocations;
    process.env = previous;
  });
  const first = await bundledProxy();
  const second = await bundledProxy();
  assert.notEqual(first.leaseCredential, second.leaseCredential);
  const provider: ProviderConfig = { id: "kimi", model: "fixture-model", apiKey: "never-sent-provider-secret", baseUrl: "https://unused.example.test/v1", bringYourOwnKey: false, inputPerMTok: 0, outputPerMTok: 0 };
  const firstLease = await first.leaseCredential({ ...provider, credentialId: "first-credential" }, "local");
  leases.push(firstLease);
  const secondLease = await second.leaseCredential({ ...provider, credentialId: "second-credential" }, "local");
  leases.push(secondLease);
  async function models(lease: CredentialLease): Promise<Response> {
    return fetch(`${lease.baseUrl}/models`, { headers: { authorization: `Bearer ${lease.token}` } });
  }
  assert.equal((await models(firstLease)).status, 200);
  const response = await models(secondLease);
  assert.equal(response.status, 200, "the first bundle's HTTP handler sees the second bundle's lease");
  assert.equal((await response.text()).includes(provider.apiKey), false);
  second.revokeCredentialLeases("first-credential");
  assert.equal((await models(firstLease)).status, 401);
  assert.equal((await models(secondLease)).status, 200);
  first.revokeCredentialLeases("second-credential");
  assert.equal((await models(secondLease)).status, 401);
});
