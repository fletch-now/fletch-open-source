import { isIPv4 } from "node:net";
import { isAbsolute, resolve, sep } from "node:path";

function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

export function validateWorkerEnvironment(env: Record<string, string | undefined>): void {
  const bind = env.FORGE_PROXY_BIND ?? "";
  const [a, b] = bind.split(".").map(Number);
  const privateAddress = a === 127 || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
  if (!isIPv4(bind) || !privateAddress) throw new Error("Worker requires an explicit private or loopback IPv4 FORGE_PROXY_BIND.");
  const port = Number(env.FORGE_PROXY_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3901) {
    throw new Error("Worker requires a dedicated FORGE_PROXY_PORT distinct from the legacy proxy port 3901.");
  }
  if (!env.DATABASE_URL) throw new Error("Worker requires DATABASE_URL.");
  for (const name of ["FORGE_WORKSPACE_ROOT", "FORGE_CHECKPOINT_ROOT"] as const) {
    const path = env[name];
    if (!path || !isAbsolute(path) || path === "/" || ["/tmp", "/private/tmp", "/var/tmp", "/dev", "/proc", "/sys", "/run"].some((root) => contains(root, resolve(path)))) {
      throw new Error(`Worker requires ${name} on an absolute persistent storage path.`);
    }
  }
  const workspace = resolve(env.FORGE_WORKSPACE_ROOT!);
  const archive = resolve(env.FORGE_CHECKPOINT_ROOT!);
  if (contains(workspace, archive) || contains(archive, workspace)) {
    throw new Error("Worker checkpoints and live workspaces must use separate storage directories.");
  }
}
