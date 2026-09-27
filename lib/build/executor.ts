import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
type Environment = Record<string, string | undefined>;

export interface ExecutorSnapshot {
  version: 1;
  atMs: number;
  hostId: string;
  platform: "linux";
  logicalCpus: number;
  totalMemoryBytes: number;
  cgroupParent: string;
  cgroupDriver: "systemd";
  cgroupCpuQuota: number;
  cgroupMemoryBytes: number;
  sliceMemoryBytes: number;
  hostAvailableBytes: number;
  workspaceMounted: true;
  modelRelayReady: true;
}

export function executorAlias(env: Environment = process.env): string | null {
  const alias = env.FORGE_EXECUTOR_SSH;
  if (!alias) {
    if (/^(ssh|tcp|https?):/.test(env.DOCKER_HOST ?? "")) {
      throw new Error("Remote Docker requires a reviewed SSH executor and remote resource observations.");
    }
    return null;
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(alias) || env.DOCKER_HOST !== `ssh://${alias}` || env.DOCKER_CONTEXT) {
    throw new Error("The Docker endpoint must match the configured SSH executor without a context override.");
  }
  if (!/^[a-f0-9]{64}$/.test(env.FORGE_EXECUTOR_HOST_ID ?? "") || env.DOCKER_CONFIG !== "/etc/fletch/docker-client") {
    throw new Error("Remote execution requires a pinned host identity and trusted Docker client configuration.");
  }
  return alias;
}

export function parseExecutorSnapshot(value: unknown, expectedHostId: string, now = Date.now()): ExecutorSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Executor observations are unavailable.");
  const row = value as Record<string, unknown>;
  const positive = ["logicalCpus", "totalMemoryBytes", "cgroupMemoryBytes"];
  const nonnegative = ["sliceMemoryBytes", "hostAvailableBytes"];
  if (row.version !== 1 || row.hostId !== expectedHostId || row.platform !== "linux"
    || row.cgroupDriver !== "systemd" || row.cgroupParent !== "fletch-builds.slice" || row.workspaceMounted !== true || row.modelRelayReady !== true
    || typeof row.atMs !== "number" || !Number.isSafeInteger(row.atMs) || Math.abs(now - row.atMs) > 15_000
    || positive.some(key => !Number.isSafeInteger(row[key]) || (row[key] as number) <= 0)
    || nonnegative.some(key => !Number.isSafeInteger(row[key]) || (row[key] as number) < 0)
    || typeof row.cgroupCpuQuota !== "number" || !Number.isFinite(row.cgroupCpuQuota)
    || row.cgroupCpuQuota <= 0 || row.cgroupCpuQuota > (row.logicalCpus as number)
    || (row.cgroupMemoryBytes as number) > (row.totalMemoryBytes as number)
    || (row.hostAvailableBytes as number) > (row.totalMemoryBytes as number)) {
    throw new Error("Executor identity, mounted workspaces, resource limits or observation freshness could not be verified.");
  }
  return row as unknown as ExecutorSnapshot;
}

export async function readExecutorSnapshot(env: Environment = process.env): Promise<ExecutorSnapshot> {
  const alias = executorAlias(env);
  if (!alias) throw new Error("Remote executor is not configured.");
  const result = await exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, "fletch-executor-inspect"],
    { timeout: 8_000, maxBuffer: 8192 });
  return parseExecutorSnapshot(JSON.parse(result.stdout), env.FORGE_EXECUTOR_HOST_ID!);
}
