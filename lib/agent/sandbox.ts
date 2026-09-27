import "server-only";
import { sandboxLimits } from "@/lib/build/capacity";

// The one place the container lockdown is defined. The agent executes
// model-authored code and the toolchain compiles it, so both run here: no
// capabilities, no privilege escalation, read-only root, bounded CPU/memory/PIDs,
// and nothing mounted but the build workspace.

export interface SandboxOptions {
  image: string;
  workspace: string;
  // Named so the container can be stopped even when the `docker run` client is
  // killed — killing the client does not stop the container it started.
  name: string;
  // Compile and test runs need no network at all: solc and forge-std are baked
  // into the image. Cutting egress there removes the only route by which
  // model-authored code could post anything it found to an outside host.
  network?: "none" | "default";
  // The agent turn talks to the model through the credential proxy on the host
  // (lib/agent/credential-proxy.ts), reached as host.docker.internal.
  hostGateway?: boolean;
}

export function sandboxArgs(options: SandboxOptions, command: string[]): string[] {
  const network = options.network ?? "default";
  const limits = sandboxLimits();
  // Run as the host uid that owns the workspace, so the agent can read the config
  // written for it and the files it creates come back owned by the server user.
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
  return [
    "run",
    "--rm",
    "--name",
    options.name,
    "--user",
    `${uid}:${gid}`,
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    `--memory=${limits.memoryBytes}`,
    `--cpus=${limits.cpus}`,
    ...(limits.cgroupParent ? [`--cgroup-parent=${limits.cgroupParent}`] : []),
    "--pids-limit=256",
    // Tool crashes must not fill the source workspace with kernel core dumps.
    "--ulimit=core=0:0",
    ...(network === "none" ? ["--network=none"] : []),
    ...(options.hostGateway ? ["--add-host=host.docker.internal:host-gateway"] : []),
    "-v",
    `${options.workspace}:/work`,
    "-w",
    "/work",
    "-e",
    "HOME=/work/.agent-home",
    options.image,
    ...command,
  ];
}

export function sandboxImage(): string | null {
  const image = process.env.FORGE_AGENT_IMAGE;
  return process.env.FORGE_AGENT_SANDBOX === "docker" && image ? image : null;
}

// Model-authored code, and the toolchain that runs over it, execute only in
// the sandbox. Without an image the only honest outcome is a refusal; a laptop
// that wants host execution says so with FORGE_UNSAFE_HOST_TOOLS=1.
export function requireSandboxImage(): string | null {
  const image = sandboxImage();
  if (image || process.env.FORGE_UNSAFE_HOST_TOOLS === "1") {
    return image;
  }
  throw new Error("Refusing to run model-authored code on this host: FORGE_AGENT_IMAGE is not set.");
}
