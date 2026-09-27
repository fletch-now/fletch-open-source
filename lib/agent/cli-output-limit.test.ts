import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import type { CliEvent } from "./cli-events";
import type { CliRunOptions } from "./cli-runner";
import { AGENT_CONTEXT_RESERVE_TOKENS } from "./context-policy";

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("the real CLI close handler preserves trusted output-limit classification and known usage", { timeout: 10_000 }, async function cliOutputLimit(t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-cli-output-limit-"));
  let requests = 0;
  const upstream = createServer(async function reply(req, res) {
    for await (const chunk of req) void chunk;
    requests++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "known-limited", choices: [{ finish_reason: "length", message: {
      tool_calls: [{ id: "write", function: { name: "WriteFile", arguments: '{"content":"incomplete' } }],
    } }], usage: { prompt_tokens: 11, completion_tokens: 8192 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const proxyPort = (reserve.address() as AddressInfo).port;
  await close(reserve);
  const env = { PATH: `${root}:${process.env.PATH}`, FORGE_AGENT_SANDBOX: "docker", FORGE_AGENT_IMAGE: "fixture",
    FORGE_PROXY_BIND: "127.0.0.1", FORGE_PROXY_PORT: String(proxyPort) };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async function cleanup() {
    await close(upstream);
    await rm(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  // Only Docker execution and account authentication are fixtures. The child,
  // HTTP proxy, response parsing, usage accounting and close handler are real.
  await writeFile(join(root, "docker"), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'create') {
  const prompt = process.argv[process.argv.indexOf('-p') + 1];
  if (!prompt.includes('about 16 KiB') || !prompt.includes('not a file-size limit') || prompt.includes('below 8 KiB')) process.exit(7);
  fs.writeFileSync('prompt-checked', 'yes');
}
if (process.argv[2] === 'start') {
  const config = fs.readFileSync(process.env.HOME + '/.kimi-code/config.toml', 'utf8');
  if (!config.includes('reserved_context_size = ${AGENT_CONTEXT_RESERVE_TOKENS}')) process.exit(10);
  const url = config.match(/base_url = "([^"]+)"/)[1].replace('host.docker.internal', '127.0.0.1');
  const token = config.match(/api_key = "([^"]+)"/)[1];
  fetch(url + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({model:'fixture',messages:[{role:'user',content:'owned loopback fixture'}]}) }).then(async response => {
    if (response.status !== 400 || (await response.text()).includes('incomplete"')) process.exit(8);
    process.stderr.write('Unrelated CLI stderr, not a trusted classification source.\\n');
    process.exit(1);
  }).catch(() => process.exit(9));
}
`, { mode: 0o700 });
  const result = await build({
    stdin: { contents: 'export { runAgentCli } from "@/lib/agent/cli-runner"; export { closeCredentialProxy } from "@/lib/agent/credential-proxy";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "fixture-auth-only", setup(plugin) {
      plugin.onResolve({ filter: /^(server-only|@\/lib\/agent\/(provider-settings|user-keys))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export async function providerIntegrationEnabled(){return true;} export async function credentialStillActive(){return true;}", loader: "js" }));
    } }],
  });
  const compiled = { exports: {} as { runAgentCli: (options: CliRunOptions) => AsyncIterable<CliEvent>; closeCredentialProxy: () => Promise<void> } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(`${process.cwd()}/package.json`), compiled, compiled.exports);
  t.after(compiled.exports.closeCredentialProxy);
  const events: CliEvent[] = [];
  for await (const event of compiled.exports.runAgentCli({ workspace: root, prompt: "controlled fixture",
    provider: { id: "kimi", apiKey: "fixture-unused", model: "fixture", baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      bringYourOwnKey: false, inputPerMTok: 0, outputPerMTok: 0 } })) events.push(event);
  assert.equal(requests, 1);
  assert.equal(await readFile(join(root, "prompt-checked"), "utf8"), "yes");
  assert.deepEqual(events.find((event) => event.kind === "error"), { kind: "error", modelFailure: "output_limit",
    text: "The model reached its output limit during a tool request. Your source files are saved." });
  assert.equal(events.find((event) => event.kind === "result")?.outputTokens, 8192);
  assert.equal(events.some((event) => event.usageMissing || event.kind === "boundary"), false);
  await assert.rejects(readFile(join(root, ".agent-home/.kimi-code/config.toml")), { code: "ENOENT" });
});
