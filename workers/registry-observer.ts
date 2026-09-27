import { existsSync } from "node:fs";
import { config as loadEnvFile } from "dotenv";

for (const file of ["/etc/fletch/fletch.env", ".env.local"]) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

async function main(): Promise<void> {
  const deadline = setTimeout(function timedOut() {
    console.error(JSON.stringify({ scope: "registry-observer", event: "failed", reason: "deadline" }));
    process.exit(1);
  }, 40_000);
  try {
    const { observeRegistry } = await import("@/lib/registry/observer");
    const { RH_MAINNET_ID } = await import("@/lib/config");
    const result = await observeRegistry(RH_MAINNET_ID);
    console.log(JSON.stringify({ scope: "registry-observer", event: "observed", ...result }));
  } catch {
    // Database errors may contain connection strings or query values.
    console.error(JSON.stringify({ scope: "registry-observer", event: "failed", reason: "reading-or-recording-failed" }));
    process.exitCode = 1;
  } finally {
    try {
      const { close } = await import("@/lib/db");
      await close();
    } catch {
      console.error(JSON.stringify({ scope: "registry-observer", event: "failed", reason: "database-close-failed" }));
      process.exitCode = 1;
    }
    clearTimeout(deadline);
  }
}

void main();
