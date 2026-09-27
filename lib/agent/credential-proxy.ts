import { guardWorkerAllowance } from "@/lib/build/durable/budget";
import { assertWorkerExecution, currentWorkerExecution, recordWorkerContext, recordWorkerProgress, type BuildExecution } from "@/lib/build/durable/execution";
import { beginWorkerEffect, completeWorkerEffect, type WorkerClaim } from "@/lib/build/durable/ownership";
import { providerIntegrationEnabled } from "@/lib/agent/provider-settings";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { logEvent } from "@/lib/log";
import type { ProviderConfig } from "@/lib/agent/provider";
import { credentialStillActive } from "@/lib/agent/user-keys";
import { onCredentialRevoked } from "@/lib/agent/lease-revocation";
import { retryRateLimited } from "./rate-limit-retry";
import { compactionRequest, isCompactionRequest, MAX_SAVED_SUMMARY_CHARS } from "./context-policy";
import { withCodeSimplifier } from "./code-simplifier";
import { ModelHttpError, ModelOutputError, newTransportContext, requestAgent, type ModelOutputFailure, type AgentRequest, type TransportContext } from "@/lib/agent/provider-transport";

export interface UsageTotals { inputTokens: number; outputTokens: number; requests: number; reportedRequests: number; modelFailure?: ModelOutputFailure }
export interface CredentialLease { token: string; baseUrl: string; release: () => UsageTotals }
interface LeaseState {
  provider: ProviderConfig;
  totals: UsageTotals;
  expiresAt: number;
  active: AbortController | null;
  context: TransportContext;
  worker?: BuildExecution;
  parentEffect?: string;
  requestFinished?: Promise<void>;
}
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const MAX_REQUESTS_PER_LEASE = 400;
const LEASE_TTL_MS = 2 * 60 * 60 * 1000;
// The installed CLI SDK aborts at 600s. Return a terminal error before that
// independent client deadline, otherwise it can retry a billed generation.
const MAX_MODEL_REQUEST_MS = 570_000;
interface ProxyGlobal { server?: Server; starting?: Promise<Server>; leases?: Map<string, LeaseState>; inFlight?: Set<LeaseState> }
const globalState = globalThis as typeof globalThis & { __fletchCredentialProxy?: ProxyGlobal };
const state: ProxyGlobal = globalState.__fletchCredentialProxy ?? (globalState.__fletchCredentialProxy = {});
// The HTTP handler and route/instrumentation bundles must share lease ownership.
const leases = state.leases ??= new Map<string, LeaseState>();
// Revoking authentication must not lose the completion handle for a request
// that is still closing its upstream socket.
const inFlight = state.inFlight ??= new Set<LeaseState>();
const RequestSchema = z.object({
  model: z.string(), stream: z.boolean().optional(), max_tokens: z.number().int().positive().optional(), max_completion_tokens: z.number().int().positive().optional(),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().nullable().optional(),
    tool_call_id: z.string().optional(), reasoning_content: z.string().optional(),
    tool_calls: z.array(z.object({ id: z.string(), type: z.literal("function"), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
  })).min(1).max(4000),
  tools: z.array(z.object({ type: z.literal("function"), function: z.object({ name: z.string().min(1).max(128), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()) }) })).max(128).optional(),
});
function digest(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function port(): number { return Number(process.env.FORGE_PROXY_PORT ?? 3901); }
function requestTimeoutMs(): number {
  const configured = Number(process.env.FORGE_MODEL_REQUEST_TIMEOUT_MS ?? MAX_MODEL_REQUEST_MS);
  if (!Number.isFinite(configured)) return MAX_MODEL_REQUEST_MS;
  return Math.min(MAX_MODEL_REQUEST_MS, Math.max(1000, configured));
}
function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: { message } }));
}
async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
function releaseLease(key: string): UsageTotals | null {
  const lease = leases.get(key);
  if (!lease) return null;
  leases.delete(key);
  lease.active?.abort();
  lease.context.responseItems.clear();
  return lease.totals;
}
onCredentialRevoked(function revoke(id) {
  for (const [key, lease] of leases) if (lease.provider.credentialId === id) releaseLease(key);
});
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const key = auth.startsWith("Bearer ") ? digest(auth.slice(7).trim()) : "";
  const lease = leases.get(key);
  if (!lease || lease.expiresAt < Date.now()) { releaseLease(key); reject(res, 401, "Unknown or expired build token"); return; }
  if (lease.totals.modelFailure) { reject(res, 400, "The model request ended without a complete response. Start a new controlled turn."); return; }
  if (lease.active) { reject(res, 429, "One model request at a time per build"); return; }
  if (lease.totals.requests >= MAX_REQUESTS_PER_LEASE) { reject(res, 429, "This build has reached its model request limit"); return; }
  // Reserve before asynchronous ownership/body checks, so concurrent calls cannot both pass.
  const controller = new AbortController();
  lease.active = controller;
  let finishRequest: () => void = () => {};
  lease.requestFinished = new Promise<void>((resolve) => { finishRequest = resolve; });
  inFlight.add(lease);
  const startedAt = Date.now();
  const timeoutMs = requestTimeoutMs();
  let timedOut = false;
  const timeout = setTimeout(function deadline() {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  res.on("close", () => controller.abort());
  try {
    if (!await providerIntegrationEnabled(lease.provider.id)) { reject(res, 503, "The selected provider integration is paused"); return; }
    if (!await credentialStillActive(lease.provider) || !leases.has(key)) { reject(res, 401, "Reconnect the selected model key"); return; }
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: lease.provider.model, object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || path !== "/v1/chat/completions") { reject(res, 404, "Not found"); return; }
    const raw = await readBody(req);
    if (!raw) { reject(res, 413, "Request too large"); return; }
    let body: unknown;
    try { body = JSON.parse(raw.toString("utf8")); } catch { reject(res, 400, "Invalid model request"); return; }
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.model !== lease.provider.model) { reject(res, 400, "This build permits only its selected model and tools"); return; }
    if (controller.signal.aborted || !leases.has(key)) { reject(res, 401, "The build token was revoked"); return; }
    const requestIntent = `${lease.parentEffect}:request:${digest(JSON.stringify(parsed.data))}`;
    const compacting = isCompactionRequest(parsed.data as AgentRequest);
    const modelRequest = withCodeSimplifier(compacting ? compactionRequest(parsed.data as AgentRequest) : parsed.data as AgentRequest);
    if (compacting && lease.worker) await recordWorkerProgress(lease.worker,
      "Summarizing the conversation to make room for the next steps. Your source files stay saved.");
    const reply = await retryRateLimited(async function dispatch(attempt) {
      if (!leases.has(key) || !await credentialStillActive(lease.provider)) throw new Error("The build token was revoked");
      if (!await providerIntegrationEnabled(lease.provider.id)) throw new Error("The selected provider integration is paused");
      if (lease.totals.requests >= MAX_REQUESTS_PER_LEASE) throw new Error("The model request limit was reached.");
      await assertWorkerExecution(lease.worker);
      const requestKey = attempt === 0 ? requestIntent : `${requestIntent}:retry:${attempt}`;
      if (lease.worker) {
        if (!lease.parentEffect) throw new Error("Worker request has no durable parent operation.");
        await guardWorkerAllowance(lease.worker, requestKey, "model_request");
        await beginWorkerEffect(lease.worker.pool, lease.worker.claim, requestKey, "model", lease.parentEffect);
      }
      lease.totals.requests += 1;
      let reply;
      try {
        reply = await requestAgent(lease.provider, modelRequest, lease.context, controller.signal);
        if (compacting && (reply.finishReason !== "stop" || reply.message.tool_calls?.length || !reply.message.content?.trim()
            || reply.message.content.length > MAX_SAVED_SUMMARY_CHARS)) {
          throw new ModelOutputError("incomplete_summary", {
            providerRequestId: reply.id, model: reply.model, usage: reply.usage, finishReason: reply.finishReason,
          });
        }
      } catch (error) {
        // Authentication, billing and 429 rejections have a known response. Keep
        // usage unknown; timeouts, dropped connections and 5xx remain uncertain.
        if (error instanceof ModelHttpError && [401, 402, 403, 429].includes(error.status) && lease.worker) {
          await completeWorkerEffect(lease.worker.pool, lease.worker.claim, requestKey, {
            outcome: "provider_rejected", httpStatus: error.status, retryAfterSeconds: error.retryAfterSeconds, usage: "unknown",
          });
        }
        if (error instanceof ModelOutputError) {
          // A received, rejected completion is definitive. Store its usage without
          // handing any partial tool arguments to the CLI or replaying this intent.
          if (lease.worker) await completeWorkerEffect(lease.worker.pool, lease.worker.claim, requestKey, {
            ...error.receipt, outcome: error.code === "output_limit" ? "output_limited" : error.code,
          });
          lease.totals.modelFailure = error.code;
          if (error.receipt.usage) {
            lease.totals.inputTokens += error.receipt.usage.inputTokens;
            lease.totals.outputTokens += error.receipt.usage.outputTokens;
            lease.totals.reportedRequests += 1;
          }
        }
        throw error;
      }
      if (lease.worker) await completeWorkerEffect(lease.worker.pool, lease.worker.claim, requestKey, {
        providerRequestId: reply.id, model: reply.model, usage: reply.usage ?? null, outcome: "response_received",
      });
      return reply;
    }, { signal: controller.signal, async onWait(milliseconds, attempt) {
      const seconds = Math.ceil(milliseconds / 1000);
      if (lease.worker) await recordWorkerProgress(lease.worker,
        `The model provider is busy. Retrying this request in about ${seconds} seconds (${attempt}/2). Your conversation and saved files are retained.`);
      logEvent("proxy", { event: "rate-limit-retry", buildId: lease.provider.buildId, attempt, waitMs: milliseconds });
    } });
    if (timedOut) throw new Error("The model exceeded the response time limit.");
    if (!leases.has(key) || controller.signal.aborted) { reject(res, 401, "The build token was revoked or expired"); return; }
    if (compacting && lease.worker) {
      await recordWorkerContext(lease.worker, reply.message.content!, requestIntent);
      await recordWorkerProgress(lease.worker,
        "Conversation summary saved. Continuing with the remaining work.");
    }
    if (reply.usage) { lease.totals.inputTokens += reply.usage.inputTokens; lease.totals.outputTokens += reply.usage.outputTokens; lease.totals.reportedRequests += 1; }
    const usage = reply.usage ? { prompt_tokens: reply.usage.inputTokens, completion_tokens: reply.usage.outputTokens } : null;
    const common = { id: reply.id, model: reply.model, created: Math.floor(Date.now() / 1000) };
    if (!parsed.data.stream) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ...common, object: "chat.completion", choices: [{ index: 0, message: reply.message, finish_reason: reply.finishReason }], usage }));
      return;
    }
    // Emit only complete tool arguments. Native upstream events are buffered here.
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    const delta = { ...reply.message, tool_calls: reply.message.tool_calls?.map((call, index) => ({ ...call, index })) };
    res.write(`data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: reply.finishReason }], usage })}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch (error) {
    // Only transport-generated messages are exposed; neither network diagnostics nor provider bodies escape.
    let message = error instanceof Error && error.message.startsWith("The model") ? error.message : "Model request failed";
    let reason: string = error instanceof ModelOutputError ? error.code : "upstream";
    let status = lease.worker || error instanceof ModelOutputError ? 400 : 502;
    if (controller.signal.aborted) reason = "aborted";
    if (timedOut) {
      reason = "deadline";
      // The CLI retries 408/5xx up to ten times, repeating billed generation.
      status = 400;
      message = "The model exceeded the response time limit. The request was stopped. Try a smaller task or retry explicitly.";
    }
    logEvent("proxy", { event: "request-failed", buildId: lease.provider.buildId, provider: lease.provider.id, reason,
      httpStatus: error instanceof ModelHttpError ? error.status : undefined,
      retryAfterSeconds: error instanceof ModelHttpError ? error.retryAfterSeconds : undefined,
      durationMs: Date.now() - startedAt, timeoutMs });
    if (!res.headersSent) reject(res, status, message);
    else res.end();
  } finally { clearTimeout(timeout); lease.active = null; inFlight.delete(lease); finishRequest(); }
}
function listen(host: string): Promise<Server> {
  return new Promise(function start(resolve, rejectStart) {
    const server = createServer(function onRequest(req, res) { void handle(req, res).catch(function failed() { if (!res.headersSent) reject(res, 500, "Model proxy unavailable"); else res.end(); }); });
    server.requestTimeout = 200_000;
    server.headersTimeout = 15_000;
    server.on("error", rejectStart);
    server.listen(port(), host, function ready() { resolve(server); });
  });
}
export async function leaseCredential(provider: ProviderConfig, reach: "docker" | "local", signal?: AbortSignal): Promise<CredentialLease> {
  const host = process.env.FORGE_PROXY_BIND ?? (reach === "docker" ? "0.0.0.0" : "127.0.0.1");
  if (!state.server) { state.starting ??= listen(host); state.server = await state.starting; }
  signal?.throwIfAborted();
  const token = `fbt_${randomBytes(24).toString("base64url")}`;
  const key = digest(token);
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, requests: 0, reportedRequests: 0 };
  const worker = currentWorkerExecution();
  leases.set(key, { provider, totals, expiresAt: Date.now() + LEASE_TTL_MS, active: null, context: newTransportContext(), worker, parentEffect: worker?.activeKey ?? undefined });
  const expiry = setTimeout(() => releaseLease(key), LEASE_TTL_MS);
  expiry.unref();
  function release(): UsageTotals {
    clearTimeout(expiry);
    signal?.removeEventListener("abort", release);
    releaseLease(key);
    return totals;
  }
  signal?.addEventListener("abort", release, { once: true });
  if (signal?.aborted) release();
  return { token, baseUrl: `http://${reach === "docker" ? "host.docker.internal" : "127.0.0.1"}:${port()}/v1`, release };
}

export async function closeCredentialProxy(): Promise<void> {
  for (const key of leases.keys()) releaseLease(key);
  const server = state.server;
  state.server = undefined;
  state.starting = undefined;
  if (server) await new Promise<void>(function close(resolve, rejectClose) {
    server.closeAllConnections();
    server.close(function closed(error) { if (error) rejectClose(error); else resolve(); });
  });
}

// A worker's terminal cleanup also covers a lease whose CLI exited without
// releasing it. Match the whole claim so another attempt cannot be revoked.
export async function revokeWorkerCredentials(claim: WorkerClaim): Promise<void> {
  const pending: Promise<void>[] = [];
  const owned = new Set<LeaseState>();
  for (const lease of new Set([...leases.values(), ...inFlight])) {
    const owner = lease.worker?.claim;
    if (!owner || owner.buildId !== claim.buildId || owner.ownerId !== claim.ownerId
      || owner.fence !== claim.fence || owner.attempt !== claim.attempt) continue;
    owned.add(lease);
    if (lease.requestFinished) pending.push(lease.requestFinished);
    lease.active?.abort();
  }
  for (const [key, lease] of leases) if (owned.has(lease)) releaseLease(key);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.all(pending), new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Model request cleanup is unconfirmed.")), 10_000);
    })]);
  } finally { clearTimeout(timeout); }
}
