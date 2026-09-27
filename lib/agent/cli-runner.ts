import { friendlyAgentFailure } from "./cli-failure";
import { knownAgentSessions, readCleanAgentSession } from "./cli-continuation";
import { workerAllowance } from "@/lib/build/durable/budget";
import { currentWorkerExecution, workerEvents } from "@/lib/build/durable/execution";
import { spawn } from "node:child_process";
import { buildSignal, checkBuildCancellation } from "@/lib/build/cancellation";
import { prepareBuildProcess, watchBuildProcess } from "@/lib/build/process-cancellation";
import "server-only";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseKimiLine, type CliEvent } from "@/lib/agent/cli-events";
import { CliOutput } from "./cli-output";
import { logEvent } from "@/lib/log";
import { requireSandboxImage, sandboxArgs } from "@/lib/agent/sandbox";
import { leaseCredential, type CredentialLease } from "@/lib/agent/credential-proxy";
import { costUsd, type ProviderConfig } from "@/lib/agent/provider";
import { agentContextBudget, AGENT_CONTEXT_RESERVE_TOKENS, AGENT_OUTPUT_TOKENS, COMPACTION_GUIDANCE } from "./context-policy";

// Runs a real coding-agent CLI in a workspace directory — the same binary a human
// would run in a terminal — and normalises its output. The CLI owns the tool loop
// (read/write/bash), so it can compile, read errors and retry, which a single chat
// completion cannot. The sandboxed Kimi CLI emits a session id for resuming.

export interface CliRunOptions {
  workspace: string;
  prompt: string;
  provider: ProviderConfig;
  resumeSessionId?: string;
  signal?: AbortSignal;
  // Called with a function that kills the agent's container.
  onStop?: (stop: () => void) => void;
}

// kimi-code reads its provider from ~/.kimi-code/config.toml. Giving the child a
// private HOME keeps the server independent of whatever the host operator has
// configured. The key written here is a per-build proxy token, never the
// platform key: the agent can read its own config, and it is model-driven.

// The docker client's environment: a PATH and a HOME, and the daemon address
// when one is configured. Nothing else from this process, least of all its
// secrets, belongs in a child that only launches a container.
function dockerClientEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, NODE_ENV: process.env.NODE_ENV };
  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }
  if (process.env.DOCKER_HOST) {
    env.DOCKER_HOST = process.env.DOCKER_HOST;
  }
  if (process.env.DOCKER_CONFIG) {
    env.DOCKER_CONFIG = process.env.DOCKER_CONFIG;
  }
  return env;
}

async function writeKimiConfig(home: string, provider: ProviderConfig, lease: CredentialLease, maxSteps?: number): Promise<void> {
  const dir = join(home, ".kimi-code");
  await mkdir(dir, { recursive: true });
  const model = provider.model.replace(/\[.*\]$/, "");
  const config = `default_model = "forge/${model}"

[thinking]
enabled = ${provider.id === "kimi" ? "true" : "false"}

[providers.forge]
base_url = "${lease.baseUrl}"
type = "kimi"
api_key = "${lease.token}"

[models."forge/${model}"]
provider = "forge"
model = "${model}"
max_context_size = ${agentContextBudget(model)}
max_output_size = ${AGENT_OUTPUT_TOKENS}
capabilities = ${provider.id === "kimi" ? '[ "thinking", "always_thinking", "tool_use" ]' : '[ "tool_use" ]'}
\n[loop_control]
reserved_context_size = ${AGENT_CONTEXT_RESERVE_TOKENS}
${maxSteps ? `max_steps_per_turn = ${maxSteps}\n` : ""}`;
  await writeFile(join(dir, "config.toml"), config, { mode: 0o600 });
}

function argsFor(options: CliRunOptions): string[] {
  const prompt = `${options.prompt}

Long conversations compact only when the provider needs the reserved headroom. ${COMPACTION_GUIDANCE} Keep the task list current. After compaction, continue the next unfinished task from the saved summary, then verify the relevant files and recorded results before acting.

Use complete file writes and patches. Aim for about 16 KiB of UTF-8 text per call when practical, leaving room for valid tool arguments within the model's response budget. This is guidance for individual calls, not a file-size limit; larger files and complete larger writes are supported. Trust successful tool results: do not rewrite or split saved code solely because its size exceeds this target. Use focused patches or append complete sections when a response cannot fit the remaining work. Split modules for clarity when useful. Inspect saved files and continue from them.`;
  const args = ["--output-format", "stream-json", "-p", prompt];
  if (options.resumeSessionId) args.push("-S", options.resumeSessionId);
  return args;
}

async function* runAgentCliInternal(options: CliRunOptions): AsyncIterable<CliEvent> {
  checkBuildCancellation();
  const signal = buildSignal(options.signal);
  signal?.throwIfAborted();
  const binary = process.env.FORGE_AGENT_BIN ?? "kimi";
  if (!binary.includes("kimi")) throw new Error("This sandbox supports the credential-proxied Kimi agent runtime only.");

  const image = requireSandboxImage();
  if (!image) throw new Error("A Docker image is required for model-agent execution.");
  const sandboxed = true;

  const execution = currentWorkerExecution();
  const allowance = execution ? await workerAllowance(execution) : null;
  const maxSteps = allowance?.remaining ? Math.min(allowance.remaining.maxAgentStepsPerTurn, allowance.remaining.modelRequests) : undefined;
  const previousIds = maxSteps ? await knownAgentSessions(options.workspace) : [];
  let cleanBoundary = false;
  let timedOut = false;
  const home = join(options.workspace, ".agent-home");
  const lease = await leaseCredential(options.provider, "docker", signal);
  const env = dockerClientEnv(home);
  try {
    await writeKimiConfig(home, options.provider, lease, maxSteps);
    signal?.throwIfAborted();
  }
  catch {
    lease.release();
    await rm(join(home, ".kimi-code", "config.toml"), { force: true });
    throw new Error("Could not prepare the sandbox model connection.");
  }
  const agentArgs = argsFor(options);
  // Killing the `docker run` client does not stop the container it started, so the
  // container is named and stopped by name.
  const eventScope = randomUUID();
  const containerName = `fletch-agent-${eventScope.slice(0, 8)}`;
  const command = sandboxed ? "docker" : binary;
  const commandArgs = sandboxed
    ? sandboxArgs({ image: image as string, workspace: options.workspace, name: containerName, hostGateway: true }, [
        "kimi",
        ...agentArgs,
      ])
    : agentArgs;

  logEvent("agent", { event: "spawn", container: sandboxed ? containerName : null, binary, sandboxed });
  let prepared: string[];
  try {
    prepared = await prepareBuildProcess(command, commandArgs, { cwd: options.workspace, env }, containerName);
  } catch (cause) {
    lease.release();
    await rm(join(home, ".kimi-code", "config.toml"), { force: true });
    throw cause;
  }

  const child = spawn(command, prepared, { cwd: options.workspace, env, stdio: ["ignore", "pipe", "pipe"] });
  const cancellation = watchBuildProcess(child, containerName, function revokeCredential() { lease.release(); }, signal);
  const { stop } = cancellation;
  options.onStop?.(stop);

  // A confused agent can loop indefinitely (retrying a failing install, say), which
  // burns tokens and pins a CPU. Cap every run in wall-clock time.
  const configuredTimeout = Number(process.env.FORGE_AGENT_TIMEOUT_MS ?? 600_000);
  const timeoutMs = Math.min(configuredTimeout, allowance?.remaining ? allowance.remaining.activeSeconds * 1000 : configuredTimeout);
  const timer = setTimeout(function onTimeout() {
    timedOut = true;
    push({ kind: "error", text: `The build agent ran longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped. Provider usage may still be billed; try a narrower request.` });
    stop();
  }, timeoutMs);

  const queue = new CliOutput(parseLine);
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let producerExited = false;
  let failure: string | null = null;
  let outputFailure: string | null = null;
  let cliVersion: string | null = null;

  function push(event: CliEvent): void {
    queue.push(event);
    if (queue.full && !producerExited) child.stdout.pause();
    resolveNext?.();
    resolveNext = null;
  }

  // Ops escape hatch: the CLI's raw stream is the only record of what the agent
  // actually did, and it is gone once the container is removed.
  const debugPath = process.env.FORGE_AGENT_DEBUG === "1" ? join(options.workspace, "agent-stream.log") : null;
  let debugBytes = 0;

  // Shared by the streaming loop below and the close handler's final flush, so a
  // malformed line (or a partial one left in the buffer at close) is dropped the
  // same way in both places instead of two copies of the same try/catch.
  function parseLine(line: string): CliEvent[] {
    let message: Record<string, unknown>;
    try {
      const clean = line.split(options.provider.apiKey || "__no_provider_key__").join("[redacted]").split(lease?.token ?? "__no_lease__").join("[redacted]");
      debugBytes += Buffer.byteLength(clean);
      if (debugPath && debugBytes <= 8 * 1024 * 1024) void appendFile(debugPath, `${clean}\n`).catch(() => undefined);
      message = JSON.parse(clean);
      if (message.role === "meta" && message.type === "system.version" && typeof message.version === "string") cliVersion = message.version;
    } catch {
      return [];
    }
    return parseKimiLine(message, eventScope);
  }

  child.stdout.on("data", function onData(chunk: Buffer) {
    if (outputFailure) return;
    try {
      queue.write(chunk);
      if (queue.full && !producerExited) child.stdout.pause();
    } catch (cause) {
      outputFailure = cause instanceof Error ? cause.message : "The build log could not be read. Saved source is retained.";
      push({ kind: "error", text: outputFailure });
      stop();
    }
    resolveNext?.();
    resolveNext = null;
  });

  function onExit(): void {
    // Node drains unread pipes after exit. Reapplying backpressure then prevents
    // close (and credential cleanup) while the event consumer is stalled.
    producerExited = true;
    child.stdout.resume();
  }
  child.once("exit", onExit);

  let stderrTail = "";
  child.stderr.on("data", function onError(chunk: Buffer) {
    // Keep only the last line for the user; CLI stack traces are noise to them.
    // The operator gets the last 2KB in the structured log below.
    stderrTail = (stderrTail + chunk.toString()).slice(-2048);
    failure = stderrTail.trim().split("\n").pop()?.split(options.provider.apiKey || "__no_key__").join("[redacted]").split(lease?.token ?? "__no_lease__").join("[redacted]") ?? failure;
  });

  child.on("error", function onSpawnError(cause: Error) {
    onExit();
    push({ kind: "error", text: `Could not start the build agent (${cause.message}).` });
    finished = true;
    resolveNext?.();
    resolveNext = null;
  });

  child.on("close", function onClose(code) {
    child.removeListener("exit", onExit);
    // The last line often arrives without a trailing newline — kimi-code's session
    // hint is the final line — so flush whatever is still buffered before closing.
    if (!outputFailure) {
      try { queue.end(); }
      catch (cause) {
        outputFailure = cause instanceof Error ? cause.message : "The build log could not be read. Saved source is retained.";
        push({ kind: "error", text: outputFailure });
      }
    }
    const usage = lease?.release() ?? null;
    logEvent("agent", {
      event: "exit",
      code,
      container: sandboxed ? containerName : null,
      requests: usage?.requests,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      stderrTail: code === 0 ? undefined : stderrTail.split(options.provider.apiKey || "__no_key__").join("[redacted]").split(lease?.token ?? "__no_lease__").join("[redacted]"),
    });
    // The lease token is dead now, but the config file sits in a workspace that
    // outlives the build; leave nothing that looks like a credential behind.
    void rm(join(home, ".kimi-code", "config.toml"), { force: true }).catch(function ignore() {});
    if (usage && usage.requests > 0 && usage.reportedRequests !== usage.requests) {
      push({ kind: "result", usageMissing: true });
    }
    if (usage && usage.requests > 0 && usage.reportedRequests === usage.requests) {
      push({
        kind: "result",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: costUsd(options.provider, usage.inputTokens, usage.outputTokens),
      });
    }
    cleanBoundary = code === 1 && cliVersion === "0.39.1" && Boolean(maxSteps) && !timedOut && !outputFailure && !signal?.aborted && stderrTail.includes("loop.max_steps_exceeded:");
    if ((code !== 0 || signal?.aborted) && !cleanBoundary && !outputFailure) {
      const modelFailure = !timedOut && !signal?.aborted ? usage?.modelFailure : undefined;
      let text = friendlyAgentFailure(failure, code, stderrTail);
      if (modelFailure === "output_limit") text = "The model reached its output limit during a tool request. Your source files are saved.";
      if (modelFailure === "incomplete_tool_request") text = "The model returned an incomplete tool request. Your source files are saved.";
      if (modelFailure === "incomplete_summary") text = "The model could not complete its conversation summary. Your source files and earlier history are saved. Continue to try again.";
      push({ kind: "error", text, modelFailure });
    }
    finished = true;
    resolveNext?.();
    resolveNext = null;
  });

  try {
    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>(function wait(resolve) { resolveNext = resolve; });
        continue;
      }
      const event = queue.shift() as CliEvent;
      if (!queue.full) child.stdout.resume();
      yield event;
    }
  } finally {
    if (!finished) {
      child.stdout.resume();
      stop();
    }
    lease?.release();
    clearTimeout(timer);
    await cancellation.dispose();
    await rm(join(home, ".kimi-code", "config.toml"), { force: true }).catch(() => undefined);
  }
  if (cleanBoundary && maxSteps && execution) {
    const session = await readCleanAgentSession({ workspace: options.workspace, previousIds, resumeSessionId: options.resumeSessionId, maxSteps, revokedToken: lease.token });
    execution.cleanSession = session;
    yield { kind: "init", sessionId: session.sessionId };
    yield { kind: "boundary", sessionId: session.sessionId };
  }
}

export async function* runAgentCli(options: CliRunOptions): AsyncIterable<CliEvent> {
  yield* workerEvents("agent-turn", "model", () => runAgentCliInternal(options));
}
