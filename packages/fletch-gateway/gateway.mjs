#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PROVIDERS, MAX_REQUESTS, MAX_OUTPUT_TOKENS, MAX_RUNTIME_MS, validateTask, approvalBinding, consumeApproval, sanitized } from "./policy.mjs";

const directory = join(homedir(), ".fletch-gateway");
const configFile = join(directory, "connection.json");
const input = createInterface({ input: process.stdin, output: process.stdout });
const stopping = new AbortController();
process.on("SIGINT", () => stopping.abort());
process.on("SIGTERM", () => stopping.abort());
function origin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Use an HTTPS Fletch origin, or localhost for development.");
  return url.origin;
}
async function boundedJson(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new Error("Response size limit exceeded"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function pair() {
  const serverFlag = process.argv.indexOf("--server");
  const server = origin(serverFlag >= 0 ? process.argv[serverFlag + 1] : await input.question("Fletch origin: "));
  const pairingToken = (await input.question("Paste the single-use pairing token from Settings: ")).trim();
  const response = await fetch(`${server}/api/model-gateways/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pairingToken }), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Pairing failed. Create a new pairing token in Settings.");
  const connection = await boundedJson(response, 4096);
  if (!PROVIDERS[connection.provider] || typeof connection.token !== "string" || !/^[a-zA-Z0-9_-]{32,100}$/.test(connection.token) || typeof connection.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(connection.model)) throw new Error("Invalid pairing response");
  console.log(`Account ${JSON.stringify(connection.ownerId)}; ${connection.provider} / ${connection.model} at ${server}.`);
  if ((await input.question("Type confirm to trust this account and save the gateway connection: ")).trim() !== "confirm") throw new Error("Pairing not saved. Revoke this gateway in Settings.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(configFile, JSON.stringify({ ...connection, server }), { mode: 0o600 });
  console.log(`Connection capability saved locally. Set ${PROVIDERS[connection.provider].env} locally, then run: node gateway.mjs run`);
}
async function run() {
  const connection = JSON.parse(await readFile(configFile, "utf8"));
  connection.server = origin(connection.server);
  const provider = PROVIDERS[connection.provider];
  if (!provider) throw new Error("Unknown paired provider");
  const key = process.env[provider.env] ?? "";
  if (!/^[a-zA-Z0-9_.-]{16,512}$/.test(key)) throw new Error(`Set ${provider.env} in this gateway process's environment.`);
  const approvals = new Map();
  const seen = new Set();
  console.log(`Connected to ${connection.server}; ${connection.provider} / ${connection.model}. Each build needs terminal approval. Ctrl+C revokes local approvals and stops provider calls.`);
  while (!stopping.signal.aborted) {
    let task;
    try {
      const poll = await fetch(`${connection.server}/api/model-gateways/relay`, { headers: { authorization: `Bearer ${connection.token}` }, redirect: "error", signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(20_000)]) });
      if (poll.status === 401) throw new Error("Gateway connection revoked. Pair again from Settings.");
      if (!poll.ok) { await poll.body?.cancel(); await delay(2000); continue; }
      const payload = await boundedJson(poll, 5 * 1024 * 1024);
      if (!payload.request) { await delay(1500); continue; }
      task = validateTask(payload.request, connection);
      let approval = approvals.get(task.buildId);
      if (!approval) {
        const maxRequests = Math.min(task.maxRequests, MAX_REQUESTS);
        console.log(`\nBuild ${task.buildId}\nProject ${JSON.stringify(task.projectName)} (${task.projectId})\nProvider ${connection.provider}; model ${connection.model}\nAt most ${maxRequests} model requests, ${MAX_OUTPUT_TOKENS} output tokens per request, 30 minutes. Your provider bills usage. Tools execute in Fletch's sandbox; this gateway executes no tools.`);
        const answer = await input.question("Type the full build ID to approve, or Enter to refuse: ", { signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(Math.max(1, Date.parse(task.requestExpiresAt) - Date.now()))]) });
        if (answer.trim() !== task.buildId) throw new Error("Build refused locally");
        approval = { binding: approvalBinding(task), maxRequests, used: 0, expiresAt: Math.min(Date.now() + MAX_RUNTIME_MS, Date.parse(task.expiresAt)) };
        approvals.set(task.buildId, approval);
      }
      consumeApproval(task, approval, seen);
      const headers = { "content-type": "application/json" };
      if (connection.provider === "anthropic") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
      else headers.authorization = `Bearer ${key}`;
      const response = await fetch(provider.url, { method: "POST", headers, body: JSON.stringify(task.payload.body), redirect: "error", signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(Math.max(1, Math.min(150_000, approval.expiresAt - Date.now())))]) });
      let body;
      if (response.ok) body = JSON.parse(sanitized(JSON.stringify(await boundedJson(response, 15 * 1024 * 1024)), [key, connection.token]));
      else { await response.body?.cancel(); body = { error: { message: "The local model provider rejected the request." } }; }
      const delivered = await fetch(`${connection.server}/api/model-gateways/relay`, { method: "POST", headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: JSON.stringify({ id: task.id, responseToken: task.responseToken, result: { status: response.status, body } }), redirect: "error", signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(20_000)]) });
      await delivered.body?.cancel();
      console.log(`Build ${task.buildId}: request ${approval.used}/${approval.maxRequests}, provider HTTP ${response.status}, relay ${delivered.status}.`);
    } catch (error) {
      if (stopping.signal.aborted) break;
      const message = sanitized(error instanceof Error ? error.message : "Gateway request failed", [key, connection.token, task?.responseToken]);
      console.error(message);
      if (message.includes("connection revoked")) break;
      if (task) await fetch(`${connection.server}/api/model-gateways/relay`, { method: "POST", headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: JSON.stringify({ id: task.id, responseToken: task.responseToken, result: { status: 503, body: { error: { message: "The gateway refused or could not complete this request." } } } }), redirect: "error", signal: AbortSignal.timeout(10_000) }).then((response) => response.body?.cancel()).catch(() => undefined);
      await delay(2000);
    }
  }
}
try {
  if (process.argv[2] === "pair") await pair();
  else if (process.argv[2] === "run") await run();
  else console.log("Usage: node gateway.mjs pair --server https://fletch.example\n       node gateway.mjs run");
} catch (error) { console.error(error instanceof Error ? error.message : "Gateway failed"); process.exitCode = 1; }
finally { input.close(); }
