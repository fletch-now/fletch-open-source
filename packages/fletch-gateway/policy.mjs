export const PROVIDERS = Object.freeze({
  openai: { url: "https://api.openai.com/v1/responses", path: "/responses", env: "OPENAI_API_KEY", fields: ["model", "input", "store", "include", "max_output_tokens", "tools"] },
  anthropic: { url: "https://api.anthropic.com/v1/messages", path: "/messages", env: "ANTHROPIC_API_KEY", fields: ["model", "max_tokens", "system", "messages", "tools"] },
  kimi: { url: "https://api.moonshot.ai/v1/chat/completions", path: "/chat/completions", env: "MOONSHOT_API_KEY", fields: ["model", "messages", "tools", "stream", "max_tokens"] },
});
export const MAX_REQUESTS = 60;
export const MAX_OUTPUT_TOKENS = 16384;
export const MAX_RUNTIME_MS = 30 * 60_000;

export function validateTask(task, connection, now = Date.now()) {
  const provider = PROVIDERS[connection.provider];
  if (!provider || !task || task.provider !== connection.provider || task.model !== connection.model) throw new Error("Unapproved provider or model");
  if (typeof task.id !== "string" || !/^[0-9a-f-]{36}$/.test(task.id) || typeof task.buildId !== "string" || !/^[0-9a-f-]{36}$/.test(task.buildId)) throw new Error("Invalid request/build identity");
  if (typeof task.responseToken !== "string" || !/^[a-zA-Z0-9_-]{32,100}$/.test(task.responseToken)) throw new Error("Invalid response capability");
  if (task.projectId !== null && (typeof task.projectId !== "string" || !/^[0-9a-f-]{36}$/.test(task.projectId))) throw new Error("Invalid project identity");
  if (typeof task.projectName !== "string" || task.projectName.length > 200) throw new Error("Invalid project name");
  const expires = Date.parse(task.expiresAt);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 2 * 60 * 60_000) throw new Error("Expired or excessive build lifetime");
  const requestExpires = Date.parse(task.requestExpiresAt);
  if (!Number.isFinite(requestExpires) || requestExpires <= now || requestExpires > now + 180_000) throw new Error("Expired request capability");
  if (!Number.isInteger(task.maxRequests) || task.maxRequests < 1 || task.maxRequests > 400 || task.maxOutputTokens !== MAX_OUTPUT_TOKENS) throw new Error("Invalid build budget");
  if (!task.payload || Object.keys(task.payload).some((key) => !["path", "body"].includes(key)) || task.payload.path !== provider.path) throw new Error("Disallowed upstream path or headers");
  const body = task.payload.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !provider.fields.includes(key)) || body.model !== connection.model) throw new Error("Disallowed provider request");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 4 * 1024 * 1024) throw new Error("Request too large");
  const limit = body.max_output_tokens ?? body.max_tokens;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OUTPUT_TOKENS) throw new Error("Output budget exceeded");
  if (body.stream === true || (connection.provider === "openai" && body.store !== false)) throw new Error("Unsupported provider storage/stream mode");
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 128 || body.tools.some((tool) => !tool || (connection.provider === "anthropic" ? typeof tool.name !== "string" || !tool.input_schema || "type" in tool : tool.type !== "function")))) throw new Error("Only sandbox function tools are permitted");
  const encoded = JSON.stringify(body);
  if (/"type"\s*:\s*"(?:input_file|input_image|image|image_url|document|file|computer_use|web_search|file_search)[^"]*"/.test(encoded)) throw new Error("Only text input and sandbox function tools are permitted");
  if (connection.provider === "openai" && (!Array.isArray(body.input) || body.input.some((item) => !item || ![undefined, "message", "function_call", "function_call_output", "reasoning"].includes(item.type)))) throw new Error("Unsupported Responses input");
  return { ...task, expiresAt: new Date(expires).toISOString() };
}
export function approvalBinding(task) {
  return JSON.stringify([task.buildId, task.projectId, task.provider, task.model, task.expiresAt, task.maxRequests, task.maxOutputTokens]);
}
export function consumeApproval(task, approval, seen, now = Date.now()) {
  if (Date.parse(task.requestExpiresAt) <= now || !approval || approval.binding !== approvalBinding(task) || approval.expiresAt <= now || approval.used >= approval.maxRequests || seen.has(task.id)) throw new Error("Approval is expired, revoked, replayed or exhausted");
  approval.used += 1;
  seen.add(task.id);
}
export function sanitized(text, secrets) {
  let clean = text;
  for (const secret of secrets) if (secret) clean = clean.split(secret).join("[redacted]");
  return clean;
}
