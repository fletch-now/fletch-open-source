import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { openSourceFile } from "@/lib/source-file";

const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const SESSION_ID = /^session_[a-f0-9-]{36}$/;
interface SessionEntry { sessionId: string; sessionDir: string; workDir: string }
export interface CleanAgentSession {
  sessionId: string;
  files: Record<string, string>;
}

// The installed Kimi 0.39.1 writes this boundary to its session wire, but exits
// before emitting the usual stdout session hint. Neither stderr alone nor a
// generic failed turn proves that the last tool finished.
export function validateCleanAgentWire(wire: string, maxSteps: number): void {
  const entries = wire.trim().split("\n").map(line => JSON.parse(line));
  const ended = entries.filter(entry => entry.type === "turn.ended").at(-1);
  if (!ended || ended.agentId !== "main" || ended.reason !== "failed" ||
      ended.error?.code !== "loop.max_steps_exceeded" || ended.error?.retryable !== false ||
      ended.error?.details?.maxSteps !== maxSteps) throw new Error("The agent did not reach a supported clean step boundary.");
  const endedIndex = entries.lastIndexOf(ended);
  const promptIndex = entries.findLastIndex((entry, index) => index < endedIndex && entry.type === "turn.prompt");
  const events = entries.slice(promptIndex + 1, endedIndex).filter(entry => entry.type === "context.append_loop_event")
    .map(entry => entry.event);
  const pending = new Set<string>();
  let lastStep = "";
  for (const event of events) {
    if (event.type === "tool.call") {
      if (!event.uuid || pending.has(event.uuid)) throw new Error("Invalid session tool identity.");
      pending.add(event.uuid);
    }
    if (event.type === "tool.result" && !pending.delete(event.parentUuid)) throw new Error("Session tool receipt has no matching call.");
    if (event.type === "step.begin" || event.type === "step.end") lastStep = event.type;
  }
  if (pending.size || lastStep !== "step.end") throw new Error("The session still contains an unfinished step or tool.");
  if (entries.slice(endedIndex + 1).some(entry => entry.type === "turn.prompt" || entry.type === "context.append_loop_event")) {
    throw new Error("The session changed after its clean boundary.");
  }
}

async function readSessionFile(root: string, path: string, maximum = MAX_SESSION_BYTES): Promise<string> {
  const full = join(root, path);
  if (await realpath(full) !== full) throw new Error("Session files must not follow symbolic links.");
  const handle = await openSourceFile(full);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum) throw new Error("Session file is unsafe or too large.");
    const text = await handle.readFile("utf8");
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Session changed while being read.");
    return text;
  } finally { await handle.close(); }
}

async function sessionIndex(workspace: string): Promise<SessionEntry[]> {
  const root = await realpath(workspace);
  try {
    const text = await readSessionFile(root, ".agent-home/.kimi-code/session_index.jsonl", 4 * 1024 * 1024);
    return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as SessionEntry);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

export async function knownAgentSessions(workspace: string): Promise<string[]> {
  return (await sessionIndex(workspace)).map(entry => entry.sessionId);
}

export async function readCleanAgentSession(options: {
  workspace: string; previousIds: string[]; resumeSessionId?: string; maxSteps: number; revokedToken: string;
}): Promise<CleanAgentSession> {
  const root = await realpath(options.workspace);
  const candidates = (await sessionIndex(root)).filter(entry => options.resumeSessionId
    ? entry.sessionId === options.resumeSessionId : !options.previousIds.includes(entry.sessionId));
  if (candidates.length !== 1) throw new Error("The completed agent session is ambiguous.");
  const entry = candidates[0];
  if (!SESSION_ID.test(entry.sessionId) || entry.workDir !== "/work" ||
      !new RegExp(`^/work/\\.agent-home/\\.kimi-code/sessions/wd_work_[a-f0-9]+/${entry.sessionId}$`).test(entry.sessionDir)) {
    throw new Error("The agent session belongs to an unsupported workspace.");
  }
  const relative = entry.sessionDir.slice("/work/".length);
  const stateText = await readSessionFile(root, `${relative}/state.json`, 1024 * 1024);
  const state = JSON.parse(stateText);
  if (state.id !== entry.sessionId || state.cwd !== "/work" || state.version !== 2 ||
      JSON.stringify(Object.keys(state.agents ?? {})) !== '["main"]' ||
      state.agents.main.homedir !== `${entry.sessionDir}/agents/main`) throw new Error("Unsupported agent session state.");
  const wire = await readSessionFile(root, `${relative}/agents/main/wire.jsonl`);
  validateCleanAgentWire(wire, options.maxSteps);
  const workspaces = await readSessionFile(root, ".agent-home/.kimi-code/workspaces.json", 1024 * 1024);
  const files = {
    [`${relative}/state.json`]: stateText,
    [`${relative}/agents/main/wire.jsonl`]: wire,
    ".agent-home/.kimi-code/session_index.jsonl": JSON.stringify(entry) + "\n",
    ".agent-home/.kimi-code/workspaces.json": workspaces,
  };
  // Expired per-segment proxy tokens may occur in recorded shell output. Real
  // provider keys never enter this home. Config and CLI logs are not retained.
  return { sessionId: entry.sessionId, files: Object.fromEntries(Object.entries(files).map(([path, text]) =>
    [path, options.revokedToken ? text.split(options.revokedToken).join("[revoked-build-token]") : text])) };
}
