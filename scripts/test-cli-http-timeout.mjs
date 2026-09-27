// Real installed CLI, local mock only. The default delay crosses Undici's 300s
// cutoff; no application database, provider credential or paid request is used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const image = process.env.FORGE_AGENT_IMAGE;
if (!image) throw new Error("Set FORGE_AGENT_IMAGE to the isolated image under review.");
const inContainer = process.env.FLETCH_CLI_MOCK_IN_CONTAINER === "1";
const delay = Number(process.env.FLETCH_CLI_MOCK_DELAY_MS ?? 310_000);
assert.ok(Number.isInteger(delay) && delay >= 0 && delay <= 320_000);
for (const terminal of [false, true]) {
  let requests = 0;
  const timers = new Set();
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    requests += 1;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (terminal) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "The model exceeded the response time limit. The request was stopped. Try a smaller task or retry explicitly." } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const common = { id: "local-mock", model: "selected-model", object: "chat.completion.chunk", created: 1 };
      res.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: "LOCAL_DELAY_SUCCESS" }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    }, terminal ? 1000 : delay);
    timers.add(timer);
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const workspace = await mkdtemp(join(tmpdir(), "fletch-cli-http-"));
  const name = `fletch-cli-http-${process.pid}-${terminal ? "terminal" : "delayed"}`;
  const started = Date.now();
  try {
    await mkdir(join(workspace, ".agent-home/.kimi-code"), { recursive: true });
    await writeFile(join(workspace, ".agent-home/.kimi-code/config.toml"), `default_model = "forge/selected-model"\n[thinking]\nenabled = false\n[providers.forge]\ntype = "kimi"\nbase_url = "http://host.docker.internal:${server.address().port}/v1"\napi_key = "local-fake-scoped-token"\n[models."forge/selected-model"]\nprovider = "forge"\nmodel = "selected-model"\nmax_context_size = 131072\ncapabilities = ["tool_use"]\n`);
    const args = ["run", "--rm", "--name", name, "--user", `${process.getuid()}:${process.getgid()}`, "--cap-drop=ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--memory=2g", "--cpus=1.5", "--pids-limit=256", "--add-host=host.docker.internal:host-gateway", "-v", `${workspace}:/work`, "-w", "/work", "-e", "HOME=/work/.agent-home", image, "kimi", "--output-format", "stream-json", "-p", "Reply with the local test marker and finish."];
    const child = inContainer
      ? spawn("/usr/local/bin/agent-entrypoint", ["kimi", "--output-format", "stream-json", "-p", "Reply with the local test marker and finish."], { cwd: workspace, env: { ...process.env, HOME: join(workspace, ".agent-home") }, stdio: ["ignore", "pipe", "pipe"] })
      : spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const watchdog = setTimeout(() => { if (inContainer) child.kill("SIGKILL"); else spawn("docker", ["rm", "-f", name]); }, terminal ? 30_000 : delay + 45_000);
    const progress = setInterval(() => console.log(JSON.stringify({ phase: terminal ? "terminal" : "delayed", elapsedSeconds: Math.floor((Date.now() - started) / 1000), requests })), 30_000);
    let code;
    try { code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); }); }
    finally { clearTimeout(watchdog); clearInterval(progress); }
    assert.equal(requests, 1, `The CLI must reach the mock exactly once. CLI output: ${output}`);
    assert.ok(output.length < 1_000_000);
    if (terminal) { assert.notEqual(code, 0); assert.match(output, /exceeded the response time limit/); }
    else { assert.equal(code, 0, output); assert.match(output, /LOCAL_DELAY_SUCCESS/); }
    console.log(JSON.stringify({ passed: true, phase: terminal ? "terminal" : "delayed", durationMs: Date.now() - started, requests, image }));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
}
