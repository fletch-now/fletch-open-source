import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { ProviderConfig } from "@/lib/agent/provider";

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface AgentRequest {
  model: string;
  messages: AgentMessage[];
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
}
export interface AgentReply {
  id: string;
  model: string;
  message: AgentMessage;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}
export type ModelOutputFailure = "output_limit" | "incomplete_tool_request" | "incomplete_summary";

export class ModelOutputError extends Error {
  constructor(readonly code: ModelOutputFailure, readonly receipt: {
    providerRequestId: string | null; model: string; usage: AgentReply["usage"]; finishReason: string;
  }) {
    let message = "The model returned an incomplete tool request.";
    if (code === "output_limit") message = "The model reached its output limit before completing a tool request.";
    if (code === "incomplete_summary") message = "The model did not return a complete conversation summary. Saved files and earlier history are retained.";
    super(message);
    this.name = "ModelOutputError";
  }
}

// A received status is evidence of an HTTP response, not evidence of zero usage.
export class ModelHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number | null) {
    super(`The model provider returned ${status}.`);
    this.name = "ModelHttpError";
  }
}

function retryAfterSeconds(header: string | undefined): number | null {
  if (!header || header.length > 64) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
  const date = Date.parse(value);
  if (!Number.isFinite(date) || new Date(date).toUTCString() !== value) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export interface TransportContext {
  // Responses reasoning items must accompany their tool calls on continuation.
  responseItems: Map<string, Record<string, unknown>[]>;
}
export function newTransportContext(): TransportContext { return { responseItems: new Map() }; }

interface UpstreamRequest { path: string; body: Record<string, unknown>; headers: Record<string, string> }

export function providerRequest(config: ProviderConfig, request: AgentRequest, context: TransportContext): UpstreamRequest {
  const activeCalls = new Set(request.messages.flatMap(function calls(message) { return message.tool_calls?.map(call => call.id) ?? []; }));
  for (const id of context.responseItems.keys()) if (!activeCalls.has(id)) context.responseItems.delete(id);
  if (!config.referenceImages?.length) return textProviderRequest(config, request, context);
  if (!config.capabilities?.images || config.gatewayId) throw new Error("The model connection does not support image input.");
  const content: Record<string, unknown>[] = [];
  for (const image of config.referenceImages) {
    const label = `Current build reference: brief/${image.name}`;
    const url = `data:${image.mediaType};base64,${image.data}`;
    if (config.id === "openai") {
      content.push({ type: "input_text", text: label }, { type: "input_image", image_url: url, detail: "auto" });
    } else if (config.id === "anthropic") {
      content.push({ type: "text", text: label }, { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
    } else {
      content.push({ type: "text", text: label }, { type: "image_url", image_url: { url } });
    }
  }
  // Bind references to this turn's most recent user prompt, preserving older
  // conversation turns and keeping images out of the CLI's saved session.
  const referenceMessage = request.messages.findLast((message) => message.role === "user");
  if (!referenceMessage) throw new Error("The model image request has no user prompt.");
  const upstream = textProviderRequest(config, request, context, referenceMessage, content);
  if (Buffer.byteLength(JSON.stringify(upstream.body)) > 10 * 1024 * 1024) throw new Error("The model request and images exceed the build limit.");
  return upstream;
}

function textProviderRequest(config: ProviderConfig, request: AgentRequest, context: TransportContext, referenceMessage?: AgentMessage, images: Record<string, unknown>[] = []): UpstreamRequest {
  const limit = Math.min(request.max_tokens ?? request.max_completion_tokens ?? 8192, 16384);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid model output limit.");
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` };
  if (config.id === "kimi") return { path: "/chat/completions", headers,
    body: { model: config.model, messages: request.messages.map((message) => message === referenceMessage ? { ...message, content: [...images, { type: "text", text: message.content ?? "" }] } : message), tools: request.tools, stream: false, max_tokens: limit } };
  if (config.id === "openai") {
    const input: Record<string, unknown>[] = [];
    for (const message of request.messages) {
      if (message.role === "tool") { input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content ?? "" }); continue; }
      const calls = message.tool_calls ?? [];
      const retained = calls[0] ? context.responseItems.get(calls[0].id) : undefined;
      if (retained) { input.push(...retained); continue; }
      if (message.content || message === referenceMessage) input.push({ role: message.role, content: message === referenceMessage ? [...images, { type: "input_text", text: message.content ?? "" }] : message.content });
      for (const call of calls) input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return { path: "/responses", headers, body: { model: config.model, input, store: false,
      include: ["reasoning.encrypted_content"], max_output_tokens: limit,
      tools: request.tools?.map((tool) => ({ type: "function", ...tool.function, strict: false })) } };
  }
  delete headers.authorization;
  headers["x-api-key"] = config.apiKey;
  headers["anthropic-version"] = "2023-06-01";
  const messages: Array<{ role: string; content: Record<string, unknown>[] }> = [];
  const system: string[] = [];
  for (const message of request.messages) {
    if (message.role === "system") { if (message.content) system.push(message.content); continue; }
    const content: Record<string, unknown>[] = [];
    if (message.role === "tool") content.push({ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content ?? "" });
    else {
      if (message === referenceMessage) content.push(...images);
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) content.push({ type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) });
    }
    if (content.length === 0) continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else messages.push({ role, content });
  }
  return { path: "/messages", headers, body: { model: config.model, max_tokens: limit, system: system.join("\n\n"), messages,
    tools: request.tools?.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })) } };
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
function usageNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
export function providerReply(config: ProviderConfig, body: Record<string, unknown>, context: TransportContext): AgentReply {
  if (body.error || body.type === "error") throw new Error("The provider could not complete this model request.");
  let text = "";
  let reasoning: string | undefined;
  const calls: ToolCall[] = [];
  let finishReason = "stop";
  const usage = record(body.usage);
  let input = usageNumber(usage.input_tokens);
  let output = usageNumber(usage.output_tokens);
  if (config.id === "kimi") {
    const choice = records(body.choices)[0];
    if (!choice) throw new Error("The provider returned no completion.");
    const message = record(choice.message);
    text = typeof message.content === "string" ? message.content : "";
    reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : undefined;
    for (const call of records(message.tool_calls)) {
      const fn = record(call.function);
      if (typeof call.id === "string" && typeof fn.name === "string" && typeof fn.arguments === "string") calls.push({ id: call.id, type: "function", function: { name: fn.name, arguments: fn.arguments } });
    }
    finishReason = String(choice.finish_reason ?? "stop");
    input = usageNumber(usage.prompt_tokens); output = usageNumber(usage.completion_tokens);
  } else if (config.id === "openai") {
    if (body.status !== "completed" && body.status !== "incomplete") throw new Error("The provider returned an unfinished response.");
    const items = records(body.output);
    for (const item of items) {
      if (item.type === "message") for (const part of records(item.content)) if (part.type === "output_text" && typeof part.text === "string") text += part.text;
      if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string" && typeof item.arguments === "string") calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    }
    if (calls.length) {
      const retainedBytes = Buffer.byteLength(JSON.stringify([...context.responseItems.values(), items]), "utf8");
      if (retainedBytes > 8 * 1024 * 1024) throw new Error("The model continuation exceeded this build's memory limit.");
      context.responseItems.set(calls[0].id, items);
    }
    if (body.status === "incomplete") {
      if (record(body.incomplete_details).reason !== "max_output_tokens") throw new Error("The model returned an unfinished response.");
      finishReason = "length";
    }
  } else {
    for (const part of records(body.content)) {
      if (part.type === "text" && typeof part.text === "string") text += part.text;
      if (part.type === "tool_use" && typeof part.id === "string" && typeof part.name === "string") calls.push({ id: part.id, type: "function", function: { name: part.name, arguments: JSON.stringify(part.input) } });
    }
    if (body.stop_reason === "max_tokens") finishReason = "length";
  }
  const receipt = { providerRequestId: typeof body.id === "string" ? body.id : null, model: config.model,
    usage: input === null || output === null ? null : { inputTokens: input, outputTokens: output }, finishReason };
  // Never hand partial JSON to a shell/file tool, including token-limit truncation.
  if (finishReason === "length" && calls.length) throw new ModelOutputError("output_limit", receipt);
  for (const call of calls) { try { JSON.parse(call.function.arguments); } catch { throw new ModelOutputError("incomplete_tool_request", receipt); } }
  if (calls.length) finishReason = "tool_calls";
  return { id: String(body.id ?? "completion"), model: config.model,
    message: { role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) },
    finishReason, usage: input === null || output === null ? null : { inputTokens: input, outputTokens: output } };
}
export async function requestAgent(config: ProviderConfig, request: AgentRequest, context: TransportContext, signal: AbortSignal): Promise<AgentReply> {
  const upstream = providerRequest(config, request, context);
  if (config.gatewayId) {
    const { requestGateway } = await import("@/lib/agent/gateway");
    const response = await requestGateway(config, { path: upstream.path, body: upstream.body }, signal);
    if (response.status < 200 || response.status >= 300) throw new Error(`The model gateway returned ${response.status}. Check its terminal approval and provider connection.`);
    return providerReply(config, response.body, context);
  }
  // Node fetch has a separate five-minute headers deadline. The native request
  // lets the lease's bounded AbortSignal govern long buffered model responses.
  let response: IncomingMessage;
  try {
    response = await new Promise<IncomingMessage>(function send(resolve, reject) {
      const url = new URL(`${config.baseUrl}${upstream.path}`);
      const sendRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
      const outgoing = sendRequest(url, {
        method: "POST", headers: { ...upstream.headers, "accept-encoding": "gzip, deflate, br" }, signal,
      }, resolve);
      outgoing.on("error", reject);
      outgoing.end(JSON.stringify(upstream.body));
    });
  } catch {
    throw new Error(signal.aborted ? "The model request was stopped or timed out." : "The model provider is unreachable.");
  }
  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    response.destroy();
    throw new ModelHttpError(response.statusCode ?? 502, retryAfterSeconds(response.headers["retry-after"]));
  }
  const chunks: Buffer[] = [];
  async function collect(source: AsyncIterable<Uint8Array>): Promise<void> {
    let bytes = 0;
    for await (const chunk of source) {
      bytes += chunk.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error("The model response exceeds the build limit.");
      chunks.push(Buffer.from(chunk));
    }
  }
  try {
    const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
    if (encoding === "gzip") await pipeline(response, createGunzip(), collect, { signal });
    else if (encoding === "deflate") await pipeline(response, createInflate(), collect, { signal });
    else if (encoding === "br") await pipeline(response, createBrotliDecompress(), collect, { signal });
    else if (!encoding || encoding === "identity") await pipeline(response, collect, { signal });
    else throw new Error("The model provider returned an unsupported response encoding.");
    const raw = Buffer.concat(chunks).toString("utf8").split(config.apiKey).join("[redacted]");
    return providerReply(config, record(JSON.parse(raw)), context);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The model")) throw error;
    throw new Error("The model provider returned an invalid or interrupted response.");
  } finally {
    response.destroy();
  }
}
