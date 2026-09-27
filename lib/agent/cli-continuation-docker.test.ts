import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCleanAgentSession, validateCleanAgentWire } from "./cli-continuation";

// This trusted fixture runs both the actual installed CLI and its fake provider
// inside one network-none container. No provider credential or external call.
const FIXTURE = String.raw`
import { createServer } from 'node:http';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('/work/.agent-home/.kimi-code', { recursive: true });
let requests = 0;
const observed = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  observed.push({ authorization: req.headers.authorization, hasPriorTool: body.messages?.some(message => message.role === 'tool') });
  requests++;
  const message = requests === 1
    ? { role: 'assistant', content: null, tool_calls: [{ id: 'single-owned-write', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'printf x >> /work/progress.txt' }) } }] }
    : { role: 'assistant', content: 'Saved task finished.' };
  const finish_reason = requests === 1 ? 'tool_calls' : 'stop';
  const base = { id: 'fixture-' + requests, model: 'fixture', usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } };
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason }] }) + '\n\ndata: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason }] }));
  }
});
await new Promise(resolve => server.listen(45111, '127.0.0.1', resolve));
async function run(token, sessionId) {
  await writeFile('/work/.agent-home/.kimi-code/config.toml', 'default_model = "forge/fixture"\n[providers.forge]\nbase_url = "http://127.0.0.1:45111/v1"\ntype = "kimi"\napi_key = "' + token + '"\n[models."forge/fixture"]\nprovider = "forge"\nmodel = "fixture"\nmax_context_size = 131072\ncapabilities = ["tool_use"]\n[loop_control]\nmax_steps_per_turn = 1\n');
  const args = ['--output-format', 'stream-json', '-p', sessionId ? 'Continue the saved task without repeating completed work.' : 'Write one progress marker.'];
  if (sessionId) args.push('-S', sessionId);
  const child = spawn('kimi', args, { cwd: '/work', env: { PATH: process.env.PATH, HOME: '/work/.agent-home' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const code = await new Promise(resolve => child.on('close', resolve)); clearTimeout(timer);
  return { code, stdout, stderr };
}
try {
  const first = await run('fixture-segment-one');
  const entry = JSON.parse((await readFile('/work/.agent-home/.kimi-code/session_index.jsonl', 'utf8')).trim().split('\n').at(-1));
  await writeFile('/work/boundary-wire.jsonl', await readFile(entry.sessionDir + '/agents/main/wire.jsonl'));
  await cp('/work/.agent-home', '/work/first/.agent-home', { recursive: true });
  const second = await run('fixture-segment-two', entry.sessionId);
  await writeFile('/work/receipt.json', JSON.stringify({ first, second, requests, observed, sessionId: entry.sessionId }));
} finally { server.closeAllConnections(); server.close(); }
`;

test("installed sandbox resumes a completed max-step turn with a new lease and no repeated tool write", {
  skip: process.env.FLETCH_TEST_DOCKER !== "1" || !process.env.FLETCH_TEST_WEB_IMAGE,
  timeout: 60_000,
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-session-resume-")));
  const name = `fletch-continuation-${randomUUID()}`;
  try {
    await writeFile(join(root, "fixture.mjs"), FIXTURE);
    const child = spawn("docker", ["run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw", "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      "-v", `${root}:/work`, "-w", "/work", process.env.FLETCH_TEST_WEB_IMAGE!, "node", "/work/fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => output += chunk); child.stderr.on("data", chunk => output += chunk);
    const code = await new Promise<number | null>(resolve => child.on("close", resolve));
    assert.equal(code, 0, output);
    const receipt = JSON.parse(await readFile(join(root, "receipt.json"), "utf8"));
    assert.equal(receipt.first.code, 1, receipt.first.stderr);
    assert.match(receipt.first.stderr, /loop.max_steps_exceeded/);
    validateCleanAgentWire(await readFile(join(root, "boundary-wire.jsonl"), "utf8"), 1);
    const session = await readCleanAgentSession({ workspace: join(root, "first"), previousIds: [], maxSteps: 1, revokedToken: "fixture-segment-one" });
    assert.equal(session.sessionId, receipt.sessionId);
    assert.equal(Object.keys(session.files).length, 4);
    assert.equal(Object.keys(session.files).some(path => path.endsWith("config.toml") || path.includes("logs/")), false);
    assert.equal(JSON.stringify(session.files).includes("fixture-segment-one"), false);
    await mkdir(join(root, "unsafe"));
    await symlink(join(root, "first/.agent-home"), join(root, "unsafe/.agent-home"));
    await assert.rejects(readCleanAgentSession({ workspace: join(root, "unsafe"), previousIds: [], maxSteps: 1, revokedToken: "" }), /symbolic links/);
    assert.equal(receipt.second.code, 0, receipt.second.stderr);
    assert.equal(receipt.requests, 2);
    assert.deepEqual(receipt.observed.map((entry: { authorization: string }) => entry.authorization), ["Bearer fixture-segment-one", "Bearer fixture-segment-two"]);
    assert.equal(receipt.observed[1].hasPriorTool, true);
    assert.equal(await readFile(join(root, "progress.txt"), "utf8"), "x");
    assert.ok(receipt.second.stdout.includes(receipt.sessionId));
  } finally {
    const cleanup = spawn("docker", ["rm", "--force", name], { stdio: "ignore" });
    await new Promise(resolve => cleanup.on("close", resolve));
    await rm(root, { recursive: true, force: true });
  }
});
