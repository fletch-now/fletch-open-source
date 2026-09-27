import "./server-runtime";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";

for (const file of ["/etc/fletch/fletch.env", ".env.local"]) if (existsSync(file)) loadEnv({ path: file, quiet: true });

async function verifyWorkerStopped(): Promise<void> {
  const { stdout } = await promisify(execFile)("systemctl", ["show", "fletch-build-worker.service", "--property=ActiveState,SubState,MainPID,KillMode"], { timeout: 10_000 });
  const state = Object.fromEntries(stdout.trim().split("\n").map((line) => line.split("=")));
  if (state.ActiveState !== "inactive" || state.SubState !== "dead" || state.MainPID !== "0" || state.KillMode !== "control-group") {
    throw new Error("Stop fletch-build-worker.service and confirm its entire process group exited before applying reconciliation.");
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { build: { type: "string" }, effect: { type: "string" }, "model-failures": { type: "boolean", default: false }, apply: { type: "boolean", default: false } } });
  if (!values.build || Boolean(values.effect) === values["model-failures"]) throw new Error("Usage: workers/reconcile-build.ts --build BUILD_ID (--effect EFFECT_KEY | --model-failures) [--apply]");
  const { pool, close } = await import("@/lib/db");
  try {
    if (values["model-failures"]) {
      const { reconcileModelFailure } = await import("@/lib/build/durable/model-reconciliation");
      console.log(JSON.stringify(await reconcileModelFailure(pool, { buildId: values.build, apply: values.apply, verifyWorkerStopped }), null, 2));
      return;
    }
    const { reconcileWorkerEffect } = await import("@/lib/build/durable/reconciliation");
    const report = await reconcileWorkerEffect(pool, { buildId: values.build, effectKey: values.effect!, apply: values.apply, verifyWorkerStopped });
    if (report.outcome === "applied") {
      const { reconcileLostBuildWorkers } = await import("@/lib/build/durable/runner");
      await reconcileLostBuildWorkers();
    }
    // Deliberately print only the bounded report, never raw signed bytes or
    // accepted credentials from the preparation records.
    console.log(JSON.stringify(report, null, 2));
  } finally { await close(); }
}

void main().catch(function failed(cause: unknown) {
  console.error(cause instanceof Error ? cause.message.split("\n")[0] : "Reconciliation failed.");
  process.exitCode = 1;
});
