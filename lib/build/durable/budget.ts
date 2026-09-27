import type { BuildExecution } from "./execution";
import { guardBuildAllowance, readBuildAllowance, recordBuildActiveSeconds, type AllowanceReading } from "../pricing-budget";
import { lockedWorkerClaim, workerTransaction } from "./ownership";

export class BuildBudgetPause extends Error {
  constructor(readonly reason: string) {
    super("Your progress is saved. Review the next allowance to continue, or stop the build.");
    this.name = "BuildBudgetPause";
  }
}

export async function workerAllowance(execution: BuildExecution): Promise<AllowanceReading> {
  return workerTransaction(execution.pool, async function read(client) {
    await lockedWorkerClaim(client, execution.claim);
    return readBuildAllowance(client, execution.claim.buildId);
  });
}

export async function guardWorkerAllowance(execution: BuildExecution, key: string, kind: "model_request" | "tool_run"): Promise<AllowanceReading> {
  const reading = await workerTransaction(execution.pool, async function guard(client) {
    await lockedWorkerClaim(client, execution.claim);
    return guardBuildAllowance(client, execution.claim.buildId, key, kind);
  });
  if (!reading.allowed) throw new BuildBudgetPause(reading.reason ?? "allowance");
  return reading;
}

export async function recordWorkerActiveTime(execution: BuildExecution, key: string, startedAt: number): Promise<void> {
  await workerTransaction(execution.pool, async function record(client) {
    await lockedWorkerClaim(client, execution.claim, true);
    await recordBuildActiveSeconds(client, execution.claim.buildId, key, Math.max(0, Math.ceil((performance.now() - startedAt) / 1000)));
  });
}
